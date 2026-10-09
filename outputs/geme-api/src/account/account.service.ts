import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AegisCustomerIdentity } from "../auth/aegis-customer.guard.js";

type Input = Record<string, unknown>;

function parseAvatarDataUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 3_000_000) {
    throw new BadRequestException("Ảnh đại diện không hợp lệ hoặc quá lớn.");
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) throw new BadRequestException("Ảnh đại diện chỉ nhận PNG, JPG hoặc WebP.");
  const mimeType = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) {
    throw new BadRequestException("Ảnh đại diện phải nhỏ hơn hoặc bằng 2 MB.");
  }
  const validSignature = mimeType === "image/png"
    ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : mimeType === "image/jpeg"
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!validSignature) throw new BadRequestException("Định dạng nội dung ảnh không khớp với tệp đã chọn.");
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
  return { mimeType, bytes, extension };
}

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  private async attachVerifiedEmailOrders(customerId: string, verifiedEmail: string) {
    const email = verifiedEmail.trim().toLowerCase();
    if (!email) return;
    // Previous storefront checkouts could create guest orders even while the
    // customer was signed in. Claim only unowned orders matching the verified
    // account email so they appear in this customer's history.
    await this.prisma.order.updateMany({
      where: { customerId: null, customerEmail: { equals: email, mode: "insensitive" } },
      data: { customerId },
    });
  }

  async customerId(identity: AegisCustomerIdentity) {
    const customer = await this.ensureCustomer(identity);
    return customer.id;
  }

  async profile(identity: AegisCustomerIdentity) {
    const customer = await this.ensureCustomer(identity);
    await this.attachVerifiedEmailOrders(customer.id, identity.email);
    const [orderCount, reviewCount, favoriteCount] = await Promise.all([
      this.prisma.order.count({ where: { customerId: customer.id } }),
      this.prisma.productReview.count({ where: { customerId: customer.id } }),
      this.prisma.customerFavorite.count({ where: { customerId: customer.id, product: { status: "ACTIVE" } } }),
    ]);
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      defaultAddress: customer.defaultAddress,
      avatarUrl: customer.avatarUrl,
      createdAt: customer.createdAt,
      orderCount,
      reviewCount,
      favoriteCount,
    };
  }

  async updateProfile(identity: AegisCustomerIdentity, input: Input) {
    const customer = await this.ensureCustomer(identity);
    const data: Input = {};
    if (Object.hasOwn(input, "phone")) {
      const phone = String(input.phone ?? "").trim();
      if (phone.length > 32) throw new ConflictException("Số điện thoại tối đa 32 ký tự.");
      data.phone = phone || null;
    }
    if (Object.hasOwn(input, "name")) {
      const name = String(input.name ?? "").trim();
      if (!name || name.length > 160) throw new ConflictException("Họ tên phải có từ 1 đến 160 ký tự.");
      data.name = name;
    }
    if (Object.hasOwn(input, "defaultAddress")) {
      const address = String(input.defaultAddress ?? "").trim();
      if (address.length > 2000) throw new ConflictException("Địa chỉ quá dài.");
      data.defaultAddress = address || null;
    }
    const avatar = Object.hasOwn(input, "avatarDataUrl") ? parseAvatarDataUrl(input.avatarDataUrl) : null;
    if (input.removeAvatar === true) data.avatarUrl = null;
    if (avatar) data.avatarUrl = "";
    if (!Object.keys(data).length) return this.profile(identity);

    try {
      await this.prisma.$transaction(async (transaction) => {
        if (avatar) {
          const digest = createHash("sha256").update(avatar.bytes).digest("hex");
          const asset = await transaction.mediaAsset.upsert({
            where: { sourceKey: `customer-avatars/${customer.id}` },
            create: {
              filename: `avatar-${digest.slice(0, 16)}.${avatar.extension}`,
              sourceKey: `customer-avatars/${customer.id}`,
              mimeType: avatar.mimeType,
              data: new Uint8Array(avatar.bytes),
              size: avatar.bytes.length,
              alt: `Ảnh đại diện ${customer.name}`,
            },
            update: {
              filename: `avatar-${digest.slice(0, 16)}.${avatar.extension}`,
              mimeType: avatar.mimeType,
              data: new Uint8Array(avatar.bytes),
              size: avatar.bytes.length,
              alt: `Ảnh đại diện ${customer.name}`,
            },
            select: { id: true },
          });
          data.avatarUrl = `/media/${asset.id}`;
        }
        await transaction.customer.update({ where: { id: customer.id }, data });
      });
    } catch (error: any) {
      if (error?.code === "P2002") throw new ConflictException("Thông tin khách hàng đã được sử dụng.");
      throw error;
    }
    return this.profile(identity);
  }

  async orders(identity: AegisCustomerIdentity) {
    const customer = await this.ensureCustomer(identity);
    await this.attachVerifiedEmailOrders(customer.id, identity.email);
    const orders = await this.prisma.order.findMany({
      // A guest checkout from an older storefront build may not have a
      // customerId yet. Include only those unowned orders with this verified
      // email as a read fallback while the claim above links them permanently.
      where: {
        OR: [
          { customerId: customer.id },
          { customerId: null, customerEmail: { equals: identity.email.trim().toLowerCase(), mode: "insensitive" } },
        ],
      },
      include: {
        items: {
          include: {
            product: {
              include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } },
            },
          },
        },
      },
      orderBy: { placedAt: "desc" },
      take: 100,
    });

    return orders.map((order) => ({
      id: order.code,
      date: order.placedAt,
      status: order.status,
      shippingProvider: order.shippingProvider,
      shippingMethod: order.shippingMethod,
      trackingCode: order.trackingCode,
      carrierStatusName: order.carrierStatusName,
      carrierStatusAt: order.carrierStatusAt,
      title: order.items.map((item) => `${item.productName} × ${item.quantity}`).join(", "),
      image: order.items[0]?.product?.images[0]?.url ?? null,
      price: Number(order.totalAmount),
    }));
  }

  async favorites(identity: AegisCustomerIdentity) {
    const customer = await this.ensureCustomer(identity);
    const saved = await this.prisma.customerFavorite.findMany({
      where: { customerId: customer.id, product: { status: "ACTIVE" } },
      orderBy: { createdAt: "desc" },
      include: {
        product: {
          include: {
            category: true,
            gemstoneType: true,
            materialOption: true,
            images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 2 },
            variants: { orderBy: { sortOrder: "asc" } },
          },
        },
      },
    });
    return saved.map((item) => item.product);
  }

  async addFavorite(identity: AegisCustomerIdentity, productId: string) {
    const customer = await this.ensureCustomer(identity);
    const product = await this.prisma.product.findFirst({ where: { id: productId, status: "ACTIVE" }, select: { id: true } });
    if (!product) throw new NotFoundException("Không tìm thấy sản phẩm đang bán.");
    await this.prisma.customerFavorite.upsert({
      where: { customerId_productId: { customerId: customer.id, productId } },
      create: { customerId: customer.id, productId },
      update: {},
    });
    return { productId, saved: true };
  }

  async removeFavorite(identity: AegisCustomerIdentity, productId: string) {
    const customer = await this.ensureCustomer(identity);
    await this.prisma.customerFavorite.deleteMany({ where: { customerId: customer.id, productId } });
    return { productId, saved: false };
  }

  private async ensureCustomer(identity: AegisCustomerIdentity) {
    const email = identity.email.trim().toLowerCase();
    const bySubject = await this.prisma.customer.findUnique({
      where: { authSubjectId: identity.id },
    });
    if (bySubject) return bySubject;

    const byEmail = await this.prisma.customer.findUnique({ where: { email } });
    if (byEmail) {
      if (byEmail.authSubjectId && byEmail.authSubjectId !== identity.id) {
        throw new ConflictException("Email khách hàng đã được liên kết với tài khoản khác.");
      }
      try {
        return await this.prisma.customer.update({
          where: { id: byEmail.id },
          data: { authSubjectId: identity.id, name: identity.name },
        });
      } catch (error: any) {
        if (error?.code === "P2002") {
          const linked = await this.prisma.customer.findUnique({ where: { authSubjectId: identity.id } });
          if (linked) return linked;
        }
        throw error;
      }
    }

    try {
      return await this.prisma.customer.create({
        data: { authSubjectId: identity.id, name: identity.name, email, status: "ACTIVE" },
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        const linked = await this.prisma.customer.findUnique({ where: { authSubjectId: identity.id } });
        if (linked) return linked;
        throw new ConflictException("Email khách hàng đã được sử dụng.");
      }
      throw error;
    }
  }
}

