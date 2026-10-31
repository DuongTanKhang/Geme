import { Injectable, Logger } from "@nestjs/common";

export type SePayBankAccount = {
  id: string;
  accountNumber: string;
  accountName: string;
  bankCode: string;
};

type SePayBankAccountRecord = {
  id?: unknown;
  account_number?: unknown;
  account_holder_name?: unknown;
  bank_short_name?: unknown;
  bank_code?: unknown;
  bank_bin?: unknown;
  active?: unknown;
};

const emptyQrSettings = { enabled: false, bankCode: "", accountNumber: "", accountName: "" };

@Injectable()
export class SePayBankAccountService {
  private readonly logger = new Logger(SePayBankAccountService.name);
  private cached: { expiresAt: number; account: SePayBankAccount | null } | null = null;
  private pending: Promise<SePayBankAccount | null> | null = null;

  isApiConfigured() {
    return Boolean(process.env.SEPAY_API_TOKEN?.trim());
  }

  async getSingleActiveAccount(): Promise<SePayBankAccount | null> {
    const token = process.env.SEPAY_API_TOKEN?.trim();
    if (!token) return null;
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.account;
    if (this.pending) return this.pending;

    this.pending = this.fetchSingleActiveAccount(token).then((account) => {
      this.cached = { account, expiresAt: Date.now() + 5 * 60_000 };
      return account;
    }).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async getPublicQrSettings(): Promise<typeof emptyQrSettings | { enabled: true; bankCode: string; accountNumber: string; accountName: string } | null> {
    if (!this.isApiConfigured()) return null;
    try {
      const account = await this.getSingleActiveAccount();
      if (!account) return emptyQrSettings;
      return { enabled: true, bankCode: account.bankCode, accountNumber: account.accountNumber, accountName: account.accountName };
    } catch (error) {
      this.logger.warn(`Không tải được tài khoản nhận QR từ SePay: ${error instanceof Error ? error.message : "lỗi không xác định"}`);
      return emptyQrSettings;
    }
  }

  private async fetchSingleActiveAccount(token: string): Promise<SePayBankAccount | null> {
    const baseUrl = (process.env.SEPAY_API_BASE_URL?.trim() || "https://userapi.sepay.vn/v2").replace(/\/+$/, "");
    let url: URL;
    try {
      url = new URL(`${baseUrl}/bank-accounts`);
    } catch {
      throw new Error("SEPAY_API_BASE_URL không hợp lệ.");
    }
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      throw new Error("SePay API phải sử dụng HTTPS.");
    }
    url.searchParams.set("active", "1");
    url.searchParams.set("per_page", "100");

    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`SePay API trả HTTP ${response.status}.`);
    const payload = await response.json() as { status?: unknown; data?: unknown; meta?: { pagination?: { has_more?: unknown } } };
    if (!Array.isArray(payload?.data)) throw new Error("SePay API trả dữ liệu tài khoản không hợp lệ.");
    if (payload.meta?.pagination?.has_more === true) throw new Error("Danh sách tài khoản SePay vượt quá 100; cần lọc tài khoản cho GEME.");

    const active = (payload.data as SePayBankAccountRecord[]).filter((account) => account.active === 1 || account.active === "1" || account.active === true);
    if (active.length === 0) return null;
    if (active.length !== 1) throw new Error("SePay đang có nhiều tài khoản hoạt động; cần để lại một tài khoản hoặc cấu hình lựa chọn rõ ràng.");

    const row = active[0];
    const accountNumber = String(row.account_number ?? "").trim();
    const accountName = String(row.account_holder_name ?? "").trim();
    const bankCode = String(row.bank_short_name ?? row.bank_code ?? row.bank_bin ?? "").trim();
    const id = String(row.id ?? "").trim();
    if (!id || !/^[0-9]{6,19}$/.test(accountNumber) || !accountName || !/^[a-z0-9.-]{2,20}$/i.test(bankCode)) {
      throw new Error("Tài khoản đang hoạt động trên SePay thiếu mã ngân hàng, số tài khoản hoặc tên chủ tài khoản hợp lệ.");
    }
    return { id, accountNumber, accountName, bankCode };
  }
}
