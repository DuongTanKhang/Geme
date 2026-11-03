import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAID_PAYMENT_STATES = ["PAID", "PARTIALLY_REFUNDED"] as const;
const MAX_RANGE_DAYS = 366;

function label(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized) || normalized.includes("@")) return null;
  return normalized;
}

function sourceLabel(value: unknown) {
  const normalized = label(value, 120);
  if (!normalized) return null;
  const key = normalized.toLocaleLowerCase("vi");
  if (/^(facebook|fb|meta)(\s+ads?)?$/.test(key)) return "Facebook";
  if (/^(instagram|ig)(\s+ads?)?$/.test(key)) return "Instagram";
  if (/^google(\s+(ads?|search))?$/.test(key)) return "Google";
  if (/^tiktok(\s+ads?)?$/.test(key)) return "TikTok";
  if (/^youtube(\s+ads?)?$/.test(key)) return "YouTube";
  if (/^zalo(\s+ads?)?$/.test(key)) return "Zalo";
  return normalized;
}

function pagePath(value: unknown) {
  if (typeof value !== "string" || value.length > 512 || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value.split(/[?#]/, 1)[0].replace(/[\u0000-\u001f]/g, "") || "/";
}

function classifyReferrer(host: string | null) {
  if (!host) return { source: "Trực tiếp / chưa gắn nguồn", medium: null as string | null };
  const normalized = host.replace(/^www\./, "");
  if (/(^|\.)google\./i.test(normalized)) return { source: "Google", medium: "organic" };
  if (/(^|\.)bing\.com$/i.test(normalized)) return { source: "Bing", medium: "organic" };
  if (/(^|\.)yahoo\./i.test(normalized)) return { source: "Yahoo", medium: "organic" };
  if (/(^|\.)duckduckgo\.com$/i.test(normalized)) return { source: "DuckDuckGo", medium: "organic" };
  const socialSources: Array<[RegExp, string]> = [
    [/(^|\.)facebook\.com$/i, "Facebook"], [/(^|\.)instagram\.com$/i, "Instagram"],
    [/(^|\.)tiktok\.com$/i, "TikTok"], [/(^|\.)youtube\.com$/i, "YouTube"],
    [/(^|\.)youtu\.be$/i, "YouTube"], [/(^|\.)zalo\.me$/i, "Zalo"],
  ];
  const social = socialSources.find(([pattern]) => pattern.test(normalized));
  return social ? { source: social[1], medium: "social" } : { source: normalized.slice(0, 120), medium: "referral" };
}

function parseWindow(fromValue?: string, toValue?: string) {
  const to = toValue ? new Date(toValue) : new Date();
  const from = fromValue ? new Date(fromValue) : new Date(to.getTime() - 29 * 86400000);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86400000) {
    throw new BadRequestException("Khoảng thống kê phải hợp lệ và không vượt quá 366 ngày.");
  }
  return { from, to };
}

@Injectable()
export class MarketingService {
  constructor(private readonly prisma: PrismaService) {}

  async recordPageView(body: Record<string, unknown>) {
    const id = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const visitorId = typeof body.visitorId === "string" ? body.visitorId.trim() : "";
    if (!UUID.test(id) || !UUID.test(visitorId)) throw new BadRequestException("Phiên thống kê không hợp lệ.");
    const visitorHash = createHash("sha256").update(visitorId).digest("hex");
    const path = pagePath(body.path);
    let referrerHost: string | null = null;
    if (typeof body.referrer === "string" && body.referrer.length <= 512) {
      try { referrerHost = new URL(body.referrer).hostname.toLowerCase().slice(0, 180) || null; } catch { /* Ignore invalid referrer values. */ }
    }
    const existing = await this.prisma.marketingSession.findUnique({ where: { id }, select: { visitorHash: true } });
    if (existing && existing.visitorHash !== visitorHash) throw new BadRequestException("Phiên thống kê không khớp.");
    const source = sourceLabel(body.source) || classifyReferrer(referrerHost).source;
    const medium = label(body.medium, 120) || classifyReferrer(referrerHost).medium;
    const campaign = label(body.campaign, 160);
    const now = new Date();
    const touchOnly = body.touchOnly === true;
    await this.prisma.marketingSession.upsert({
      where: { id },
      create: { id, visitorHash, source, medium, campaign, referrerHost, landingPath: path, lastPath: path, pageViews: 1, startedAt: now, lastSeenAt: now },
      update: { lastPath: path, lastSeenAt: now, ...(!touchOnly ? { pageViews: { increment: 1 } } : {}) },
    });
    return { accepted: true };
  }

  async recordSignup(sessionIdValue: unknown) {
    const sessionId = typeof sessionIdValue === "string" ? sessionIdValue.trim() : "";
    if (!UUID.test(sessionId)) return { accepted: false };
    await this.prisma.marketingSession.updateMany({
      where: { id: sessionId, signedUpAt: null },
      data: { signedUpAt: new Date() },
    });
    return { accepted: true };
  }

  async recordCartAdd(sessionIdValue: unknown) {
    const sessionId = typeof sessionIdValue === "string" ? sessionIdValue.trim() : "";
    if (!UUID.test(sessionId)) return { accepted: false };
    const now = new Date();
    await this.prisma.marketingSession.updateMany({ where: { id: sessionId }, data: { cartAddCount: { increment: 1 }, cartAddedAt: now, lastSeenAt: now } });
    return { accepted: true };
  }

  async overview(fromValue?: string, toValue?: string, includeCohorts = true) {
    const { from, to } = parseWindow(fromValue, toValue);
    const sessionWhere = { startedAt: { gte: from, lt: to } };
    const signupWhere = { signedUpAt: { gte: from, lt: to } };
    const spendWhere = { spentOn: { gte: from, lt: to } };
    const settledBefore = new Date(Date.now() - 30 * 60 * 1000);
    const [sessionCount, sessionAggregate, distinctVisitors, visitorSegments, settledSessions, bouncedSessions, cartSessions, sessionGroups, signupGroups, spendAggregate, spendGroups, spends, paidOrders, cohorts] = await Promise.all([
      this.prisma.marketingSession.count({ where: sessionWhere }),
      this.prisma.marketingSession.aggregate({ where: sessionWhere, _sum: { pageViews: true } }),
      this.prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(DISTINCT visitor_hash) AS count FROM marketing_sessions WHERE started_at >= ${from} AND started_at < ${to}`,
      this.prisma.$queryRaw<Array<{ firstTime: bigint; returning: bigint }>>`
        WITH period_visitors AS (
          SELECT DISTINCT visitor_hash FROM marketing_sessions
          WHERE started_at >= ${from} AND started_at < ${to}
        ), first_seen AS (
          SELECT visitor_hash, MIN(started_at) AS first_seen_at
          FROM marketing_sessions GROUP BY visitor_hash
        )
        SELECT COUNT(*) FILTER (WHERE first_seen.first_seen_at >= ${from} AND first_seen.first_seen_at < ${to})::bigint AS "firstTime",
               COUNT(*) FILTER (WHERE first_seen.first_seen_at < ${from})::bigint AS returning
        FROM period_visitors JOIN first_seen USING (visitor_hash)
      `,
      this.prisma.marketingSession.count({ where: { ...sessionWhere, lastSeenAt: { lt: settledBefore } } }),
      this.prisma.marketingSession.count({ where: { ...sessionWhere, lastSeenAt: { lt: settledBefore }, pageViews: 1 } }),
      this.prisma.marketingSession.count({ where: { cartAddedAt: { gte: from, lt: to } } }),
      this.prisma.marketingSession.groupBy({ by: ["source", "medium", "campaign"], where: sessionWhere, _count: { _all: true }, _sum: { pageViews: true } }),
      this.prisma.marketingSession.groupBy({ by: ["source", "medium", "campaign"], where: signupWhere, _count: { _all: true } }),
      this.prisma.marketingSpend.aggregate({ where: spendWhere, _sum: { amount: true } }),
      this.prisma.marketingSpend.groupBy({ by: ["source", "campaign"], where: spendWhere, _sum: { amount: true } }),
      this.prisma.marketingSpend.findMany({ where: spendWhere, orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }], take: 100 }),
      this.prisma.order.findMany({
        where: { marketingSessionId: { not: null }, status: { not: "CANCELLED" }, payments: { some: { status: { in: [...PAID_PAYMENT_STATES] }, paidAt: { gte: from, lt: to } } } },
        select: { id: true, marketingSessionId: true, totalAmount: true, marketingSession: { select: { source: true, medium: true, campaign: true, visitorHash: true, cartAddedAt: true } }, payments: { where: { status: { in: [...PAID_PAYMENT_STATES] }, paidAt: { not: null } }, orderBy: { paidAt: "asc" }, select: { amount: true, paidAt: true, refunds: { select: { amount: true } } } } },
      }),
      includeCohorts ? this.cohortRetention() : Promise.resolve([]),
    ]);
    const fullyPaidOrders = paidOrders.filter((order) => {
      let captured = 0;
      let settledAt: Date | null = null;
      for (const payment of order.payments) {
        captured += Number(payment.amount);
        if (!settledAt && captured >= Number(order.totalAmount)) settledAt = payment.paidAt;
      }
      return settledAt != null && settledAt >= from && settledAt < to;
    });

    const byKey = new Map<string, { source: string; medium: string; campaign: string; sessions: number; pageViews: number; signups: number; paidOrders: number; paidRevenue: number; spend: number }>();
    const normalizeKey = (source: string | null, medium: string | null, campaign: string | null) => `${source || "Trực tiếp / chưa gắn nguồn"}\u0000${medium || ""}\u0000${campaign || ""}`;
    const getGroup = (source: string | null, medium: string | null, campaign: string | null) => {
      const key = normalizeKey(source, medium, campaign);
      let item = byKey.get(key);
      if (!item) {
        item = { source: source || "Trực tiếp / chưa gắn nguồn", medium: medium || "—", campaign: campaign || "—", sessions: 0, pageViews: 0, signups: 0, paidOrders: 0, paidRevenue: 0, spend: 0 };
        byKey.set(key, item);
      }
      return item;
    };
    for (const group of sessionGroups) {
      const item = getGroup(group.source, group.medium, group.campaign);
      item.sessions = group._count._all;
      item.pageViews = group._sum.pageViews || 0;
    }
    for (const group of signupGroups) getGroup(group.source, group.medium, group.campaign).signups = group._count._all;
    for (const order of fullyPaidOrders) {
      const session = order.marketingSession;
      if (!session) continue;
      const item = getGroup(session.source, session.medium, session.campaign);
      item.paidOrders += 1;
      item.paidRevenue += order.payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) - payment.refunds.reduce((refundSum, refund) => refundSum + Number(refund.amount), 0)), 0);
    }
    const channelsMap = new Map<string, { source: string; medium: string; campaign: string; sessions: number; pageViews: number; signups: number; paidOrders: number; paidRevenue: number; spend: number }>();
    for (const row of byKey.values()) {
      const channel = row.source;
      let item = channelsMap.get(channel);
      if (!item) {
        item = { source: channel, medium: "—", campaign: "—", sessions: 0, pageViews: 0, signups: 0, paidOrders: 0, paidRevenue: 0, spend: 0 };
        channelsMap.set(channel, item);
      }
      item.sessions += row.sessions;
      item.pageViews += row.pageViews;
      item.signups += row.signups;
      item.paidOrders += row.paidOrders;
      item.paidRevenue += row.paidRevenue;
    }
    const campaignsMap = new Map<string, { source: string; medium: string; campaign: string; sessions: number; pageViews: number; signups: number; paidOrders: number; paidRevenue: number; spend: number }>();
    for (const row of byKey.values()) {
      if (row.campaign === "—") continue;
      const key = `${row.source}\u0000${row.campaign}`;
      let item = campaignsMap.get(key);
      if (!item) {
        item = { source: row.source, medium: "—", campaign: row.campaign, sessions: 0, pageViews: 0, signups: 0, paidOrders: 0, paidRevenue: 0, spend: 0 };
        campaignsMap.set(key, item);
      }
      item.sessions += row.sessions;
      item.pageViews += row.pageViews;
      item.signups += row.signups;
      item.paidOrders += row.paidOrders;
      item.paidRevenue += row.paidRevenue;
    }
    for (const group of spendGroups) {
      const source = group.source || "Trực tiếp / chưa gắn nguồn";
      const amount = Number(group._sum.amount || 0);
      const channel = channelsMap.get(source) || { source, medium: "—", campaign: "—", sessions: 0, pageViews: 0, signups: 0, paidOrders: 0, paidRevenue: 0, spend: 0 };
      channel.spend += amount;
      channelsMap.set(source, channel);
      const key = `${source}\u0000${group.campaign}`;
      const campaign = campaignsMap.get(key) || { source, medium: "—", campaign: group.campaign, sessions: 0, pageViews: 0, signups: 0, paidOrders: 0, paidRevenue: 0, spend: 0 };
      campaign.spend += amount;
      campaignsMap.set(key, campaign);
    }
    const channels = [...channelsMap.values()].sort((a, b) => b.sessions - a.sessions).map((row) => ({ ...row, cpa: row.paidOrders ? Math.round(row.spend / row.paidOrders) : null, conversionRate: row.sessions ? row.paidOrders / row.sessions : 0 }));
    const campaigns = [...campaignsMap.values()].sort((a, b) => b.spend - a.spend || b.paidOrders - a.paidOrders || b.sessions - a.sessions).slice(0, 20).map((row) => ({ ...row, cpa: row.paidOrders ? Math.round(row.spend / row.paidOrders) : null, conversionRate: row.sessions ? row.paidOrders / row.sessions : 0 }));
    const signups = [...byKey.values()].reduce((sum, row) => sum + row.signups, 0);
    const paidOrderCount = fullyPaidOrders.length;
    const paidVisitorCount = new Set(fullyPaidOrders.map((order) => order.marketingSession?.visitorHash).filter((value): value is string => Boolean(value))).size;
    const cartConvertedSessions = new Set(fullyPaidOrders
      .filter((order) => order.marketingSession?.cartAddedAt && order.marketingSession.cartAddedAt >= from && order.marketingSession.cartAddedAt < to)
      .map((order) => order.marketingSessionId)
      .filter((value): value is string => Boolean(value))).size;
    return {
      from: from.toISOString(), to: to.toISOString(),
      totals: {
        sessions: sessionCount,
        visitors: Number(distinctVisitors[0]?.count || 0),
        visitorSegments: { firstTime: Number(visitorSegments[0]?.firstTime || 0), returning: Number(visitorSegments[0]?.returning || 0) },
        settledSessions,
        bouncedSessions,
        bounceRate: settledSessions ? bouncedSessions / settledSessions : null,
        cartSessions,
        cartConvertedSessions,
        cartAbandonmentRate: cartSessions ? Math.max(0, cartSessions - cartConvertedSessions) / cartSessions : null,
        pageViews: sessionAggregate._sum.pageViews || 0,
        signups,
        paidOrders: paidOrderCount,
        spend: Number(spendAggregate._sum.amount || 0),
        cpa: paidOrderCount ? Math.round(Number(spendAggregate._sum.amount || 0) / paidOrderCount) : null,
        paidVisitors: paidVisitorCount,
        visitorToPaid: Number(distinctVisitors[0]?.count || 0) ? paidVisitorCount / Number(distinctVisitors[0]?.count || 0) : 0,
        paidRevenue: fullyPaidOrders.reduce((sum, order) => sum + order.payments.reduce((paymentSum, payment) => paymentSum + Math.max(0, Number(payment.amount) - payment.refunds.reduce((refundSum, refund) => refundSum + Number(refund.amount), 0)), 0), 0),
      },
      funnel: [
        { key: "sessions", label: "Phiên truy cập", count: sessionCount },
        { key: "signup", label: "Đăng ký đã xác minh", count: signups },
        { key: "paid", label: "Đơn đã thanh toán", count: paidOrderCount },
      ],
      channels,
      campaigns,
      cohorts,
      spends: spends.map((row) => ({ ...row, amount: Number(row.amount), spentOn: row.spentOn.toISOString().slice(0, 10) })),
    };
  }

  private async cohortRetention() {
    const rows = await this.prisma.$queryRaw<Array<{ cohort: string; month_index: number; cohort_size: bigint; active_visitors: bigint }>>`
      WITH signup_visitors AS (
        SELECT visitor_hash, MIN(signed_up_at) AS signed_up_at
        FROM marketing_sessions
        WHERE signed_up_at IS NOT NULL
        GROUP BY visitor_hash
      ), cohort_visitors AS (
        SELECT visitor_hash, date_trunc('month', signed_up_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS cohort_month
        FROM signup_visitors
        WHERE signed_up_at >= (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh') - INTERVAL '6 months') AT TIME ZONE 'Asia/Ho_Chi_Minh'
          AND signed_up_at < (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh') + INTERVAL '1 month') AT TIME ZONE 'Asia/Ho_Chi_Minh'
      ), visitor_activity AS (
        SELECT DISTINCT cv.visitor_hash, cv.cohort_month,
          (
            (EXTRACT(YEAR FROM date_trunc('month', ms.last_seen_at AT TIME ZONE 'Asia/Ho_Chi_Minh')) - EXTRACT(YEAR FROM cv.cohort_month)) * 12
            + EXTRACT(MONTH FROM date_trunc('month', ms.last_seen_at AT TIME ZONE 'Asia/Ho_Chi_Minh')) - EXTRACT(MONTH FROM cv.cohort_month)
          )::int AS month_index
        FROM cohort_visitors cv
        JOIN marketing_sessions ms ON ms.visitor_hash = cv.visitor_hash
        WHERE ms.last_seen_at >= (cv.cohort_month AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND ms.last_seen_at < ((cv.cohort_month + INTERVAL '7 months') AT TIME ZONE 'Asia/Ho_Chi_Minh')
      ), cohort_sizes AS (
        SELECT cohort_month, COUNT(*)::bigint AS cohort_size
        FROM cohort_visitors
        GROUP BY cohort_month
      )
      SELECT to_char(cs.cohort_month, 'YYYY-MM') AS cohort,
        month_grid.month_index,
        cs.cohort_size,
        COUNT(DISTINCT va.visitor_hash)::bigint AS active_visitors
      FROM cohort_sizes cs
      CROSS JOIN LATERAL generate_series(
        0,
        LEAST(6, (
          (EXTRACT(YEAR FROM date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')) - EXTRACT(YEAR FROM cs.cohort_month)) * 12
          + EXTRACT(MONTH FROM date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')) - EXTRACT(MONTH FROM cs.cohort_month)
        )::int)
      ) AS month_grid(month_index)
      LEFT JOIN visitor_activity va ON va.cohort_month = cs.cohort_month AND va.month_index = month_grid.month_index
      GROUP BY cs.cohort_month, cs.cohort_size, month_grid.month_index
      ORDER BY cs.cohort_month ASC, month_grid.month_index ASC`;
    const cohorts = new Map<string, { cohort: string; size: number; months: Array<number | null> }>();
    for (const row of rows) {
      let cohort = cohorts.get(row.cohort);
      if (!cohort) {
        cohort = { cohort: row.cohort, size: Number(row.cohort_size), months: Array(7).fill(null) };
        cohorts.set(row.cohort, cohort);
      }
      if (row.month_index >= 0 && row.month_index < 7 && cohort.size > 0) cohort.months[row.month_index] = Number(row.active_visitors) / cohort.size;
    }
    return [...cohorts.values()];
  }

  async createSpend(actor: AdminIdentity, body: Record<string, unknown>) {
    const date = typeof body.spentOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.spentOn) ? new Date(`${body.spentOn}T00:00:00.000Z`) : null;
    const source = sourceLabel(body.source);
    const campaign = label(body.campaign, 160);
    const amount = Number(body.amount);
    const note = label(body.note, 500);
    if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.spentOn) throw new BadRequestException("Ngày chi phí chưa hợp lệ.");
    if (!source || !campaign) throw new BadRequestException("Cần nhập kênh và tên chiến dịch.");
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000_000) throw new BadRequestException("Chi phí phải là số nguyên dương hợp lệ.");
    if (Object.keys(body).some((key) => !["spentOn", "source", "campaign", "amount", "note"].includes(key))) throw new BadRequestException("Dữ liệu chi phí chứa trường không được hỗ trợ.");
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.marketingSpend.create({ data: { id: randomUUID(), spentOn: date, source, campaign, amount, note: note || null, createdByAdminId: actor.id } });
      await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "MARKETING_SPEND_CREATED", entityType: "MARKETING_SPEND", entityId: row.id, after: { ...row, amount: Number(row.amount) } as any } });
      return { ...row, amount: Number(row.amount), spentOn: row.spentOn.toISOString().slice(0, 10) };
    });
  }
}
