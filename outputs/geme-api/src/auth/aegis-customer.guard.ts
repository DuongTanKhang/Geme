import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

export type AegisCustomerIdentity = {
  id: string;
  name: string;
  email: string;
  emailVerified: true;
};

type CustomerRequest = {
  headers: { authorization?: string };
  customerIdentity?: AegisCustomerIdentity;
};

@Injectable()
export class AegisCustomerGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Đăng nhập để tiếp tục.");
    }

    const baseUrl = process.env.AEGIS_AUTH_API_URL?.replace(/\/$/, "")
      ?? (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:5130");
    if (!baseUrl) {
      throw new ServiceUnavailableException("Chưa cấu hình dịch vụ xác thực.");
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/auth/me`, {
        method: "GET",
        headers: { Authorization: authorization, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ServiceUnavailableException("Không thể kết nối dịch vụ xác thực.");
    }

    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException("Phiên đăng nhập đã hết hạn.");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Dịch vụ xác thực đang gặp sự cố.");
    }

    const identity = await response.json() as Partial<AegisCustomerIdentity>;
    if (
      typeof identity.id !== "string"
      || typeof identity.email !== "string"
      || typeof identity.name !== "string"
      || identity.emailVerified !== true
    ) {
      throw new UnauthorizedException("Tài khoản chưa được xác minh.");
    }

    request.customerIdentity = identity as AegisCustomerIdentity;
    return true;
  }
}
