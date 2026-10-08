import { NextRequest, NextResponse } from "next/server";
import { callAegis, callGemePublicApi, upstreamError } from "../../../lib/customer-session";

type CustomerRecord = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  authSubjectId?: string | null;
  defaultAddress?: string | null;
  status?: string;
  segment?: string | null;
  avatarUrl?: string | null;
  note?: string | null;
};

const normalizePhone = (value: unknown) => {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("84") && digits.length >= 10) digits = `0${digits.slice(2)}`;
  return digits;
};

async function restoreStoreCustomer(customer: CustomerRecord) {
  await callGemePublicApi(`/customers/${encodeURIComponent(customer.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: customer.name,
      email: customer.email || null,
      phone: customer.phone || null,
      defaultAddress: customer.defaultAddress || null,
      status: customer.status || "ACTIVE",
      segment: customer.segment || "Khách mới",
      avatarUrl: customer.avatarUrl || null,
      note: customer.note || null,
    }),
  });
}

export async function POST(request: NextRequest) {
  let linkedStoreCustomer: CustomerRecord | undefined;
  let previousEmail: string | null = null;
  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const phone = normalizePhone(body.phone);
    if (!email || !password || phone.length < 9 || phone.length > 12) {
      return NextResponse.json({ message: "Vui lòng nhập số điện thoại hợp lệ, email và mật khẩu." }, { status: 400 });
    }

    const customersResponse = await callGemePublicApi(`/customers?search=${encodeURIComponent(phone.slice(-9))}`);
    if (!customersResponse.ok) {
      return NextResponse.json({ message: "Không kiểm tra được hồ sơ khách hàng. Vui lòng thử lại." }, { status: 503 });
    }
    const customers = await customersResponse.json() as CustomerRecord[];
    linkedStoreCustomer = customers.find((customer) => normalizePhone(customer.phone) === phone);

    if (linkedStoreCustomer?.authSubjectId) {
      return NextResponse.json({ message: "Số điện thoại này đã có tài khoản GEME. Vui lòng đăng nhập bằng Gmail đã đăng ký." }, { status: 409 });
    }
    if (linkedStoreCustomer?.email && linkedStoreCustomer.email.toLowerCase() !== email) {
      return NextResponse.json({ message: "Hồ sơ khách hàng này đã gắn với một email khác. Vui lòng dùng email đó hoặc liên hệ cửa hàng." }, { status: 409 });
    }

    const accountName = linkedStoreCustomer?.name?.trim() || name;
    if (!accountName) return NextResponse.json({ message: "Nhập họ tên nếu bạn chưa tạo hồ sơ khách hàng tại cửa hàng." }, { status: 400 });
    if (linkedStoreCustomer) {
      previousEmail = linkedStoreCustomer.email || null;
      const linked = await callGemePublicApi(`/customers/${encodeURIComponent(linkedStoreCustomer.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: accountName,
          email,
          phone,
          defaultAddress: linkedStoreCustomer.defaultAddress || null,
          status: linkedStoreCustomer.status || "ACTIVE",
          segment: linkedStoreCustomer.segment || "Khách mới",
          avatarUrl: linkedStoreCustomer.avatarUrl || null,
          note: linkedStoreCustomer.note || null,
        }),
      });
      if (!linked.ok) {
        const problem = await linked.json().catch(() => ({})) as { message?: string };
        return NextResponse.json({ message: problem.message || "Không thể liên kết hồ sơ khách hàng với email này." }, { status: linked.status });
      }
    }

    const upstream = await callAegis("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name: accountName, email, password }),
    });
    if (!upstream.ok) {
      if (linkedStoreCustomer) await restoreStoreCustomer({ ...linkedStoreCustomer, email: previousEmail });
      return upstreamError(upstream);
    }
    const registration = await upstream.json() as {
      codeLength?: number;
      lifetimeMinutes?: number;
      resendCooldownSeconds?: number;
    };
    const verificationSettings = {
      codeLength: registration.codeLength ?? 6,
      lifetimeMinutes: registration.lifetimeMinutes ?? 5,
      resendCooldownSeconds: registration.resendCooldownSeconds ?? 60,
    };

    if (!linkedStoreCustomer) {
      const saved = await callGemePublicApi("/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: accountName, email, phone, status: "ACTIVE", segment: "Khách mới" }),
      });
      if (!saved.ok) {
        return NextResponse.json({
          registered: true,
          ...verificationSettings,
          message: "Tài khoản đã được tạo. Nhập mã xác nhận trong email để hoàn tất đăng ký; thông tin khách hàng sẽ được đồng bộ sau khi đăng nhập lần đầu.",
        }, { status: 201 });
      }
    }

    return NextResponse.json({
      registered: true,
      ...verificationSettings,
      message: linkedStoreCustomer
        ? "Đã tìm thấy hồ sơ tại cửa hàng và dùng họ tên đã lưu để tạo tài khoản. Hãy nhập mã trong Gmail để xác nhận địa chỉ email."
        : "Tài khoản đã được tạo. Hãy nhập mã xác nhận trong email để hoàn tất đăng ký.",
    }, { status: 201 });
  } catch {
    if (linkedStoreCustomer) {
      try { await restoreStoreCustomer({ ...linkedStoreCustomer, email: previousEmail }); } catch { /* Preserve the original registration error. */ }
    }
    return NextResponse.json({ message: "Không kết nối được máy chủ xác thực." }, { status: 503 });
  }
}

