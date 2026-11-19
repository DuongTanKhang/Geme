import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { CUSTOMER_POLICY_DEFAULTS } from "./policy-defaults.js";
import { CustomerPoliciesService } from "./customer-policies.service.js";

function makeService(initial?: unknown) {
  let value: unknown = initial;
  const prisma = {
    siteSetting: {
      upsert: async (args: any) => {
        if (value === undefined) value = args.create.value;
        if (args.update?.value !== undefined) value = args.update.value;
        return { value, updatedAt: new Date("2026-01-01T00:00:00Z") };
      },
    },
  };
  return new CustomerPoliciesService(prisma as any);
}

test("draft policy is not exposed as registration consent text", async () => {
  const service = makeService();
  const policy = await service.registrationPrivacyPolicy();
  assert.equal(policy.status, "DRAFT");
  assert.equal(policy.content, "");
});

test("published privacy policy is returned for registration consent", async () => {
  const policies = CUSTOMER_POLICY_DEFAULTS.map((policy) => ({ ...policy, status: policy.slug === "bao-mat" ? "PUBLISHED" : "DRAFT", content: `Nội dung ${policy.slug}` }));
  const service = makeService(policies);
  const policy = await service.registrationPrivacyPolicy();
  assert.equal(policy.status, "PUBLISHED");
  assert.equal(policy.content, "Nội dung bao-mat");
});

test("policy save rejects unknown slugs without writing them", async () => {
  const service = makeService();
  await assert.rejects(() => service.save([{ slug: "unknown", title: "x", content: "x" }]), BadRequestException);
});
