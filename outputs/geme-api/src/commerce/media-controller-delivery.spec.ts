import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { CommerceController } from "./commerce.controller.js";

function makeResponse() {
  const headers = new Map<string, string>();
  return {
    headers,
    body: undefined as Uint8Array | undefined,
    redirectResult: undefined as { status: number; url: string } | undefined,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    end(data?: Uint8Array) { this.body = data; },
    redirect(status: number, url: string) { this.redirectResult = { status, url }; },
  };
}

test("legacy SKU product images redirect to the public Worker delivery path", async () => {
  const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  let readCalls = 0;
  const media = {
    findById: async () => ({ id: "asset-1", isPrivate: false, storageProvider: "r2", objectKey: "product-images/NSBAFO04S50/NSBAFO04S50-1.jpg", mimeType: "image/jpeg", size: imageBytes.length }),
    publicDeliveryUrl: () => "https://media.example.test/product-images/NSBAFO04S50/NSBAFO04S50-1.jpg",
    read: async () => { readCalls++; return imageBytes; },
  };
  const controller = new CommerceController({} as never, {} as never, {} as never, media as never);
  const response = makeResponse();

  await controller.media("asset-1", { headers: {} }, response as never);

  assert.deepEqual(response.redirectResult, { status: 302, url: "https://media.example.test/product-images/NSBAFO04S50/NSBAFO04S50-1.jpg" });
  assert.equal(response.body, undefined);
  assert.equal(response.headers.get("content-type"), undefined);
  assert.equal(readCalls, 0);
});

test("content-addressed media keeps the CDN redirect path", async () => {
  let readCalls = 0;
  const media = {
    findById: async () => ({ id: "asset-2", isPrivate: false, storageProvider: "r2", objectKey: "media/abc123.jpg", mimeType: "image/jpeg", size: 4 }),
    publicDeliveryUrl: () => "https://media.example.test/media/abc123.jpg",
    read: async () => { readCalls++; return new Uint8Array([1]); },
  };
  const controller = new CommerceController({} as never, {} as never, {} as never, media as never);
  const response = makeResponse();

  await controller.media("asset-2", { headers: {} }, response as never);

  assert.deepEqual(response.redirectResult, { status: 302, url: "https://media.example.test/media/abc123.jpg" });
  assert.equal(response.body, undefined);
  assert.equal(readCalls, 0);
});

test("private assets still require Admin authentication before R2 reads", async () => {
  let readCalls = 0;
  const media = {
    findById: async () => ({ id: "private-asset", isPrivate: true, storageProvider: "r2", objectKey: "product-images/NSBAFO04S50/original.jpg", mimeType: "image/jpeg", size: 4 }),
    publicDeliveryUrl: () => null,
    read: async () => { readCalls++; return new Uint8Array([1]); },
  };
  const auth = { authenticateAuthorization: async () => null };
  const controller = new CommerceController({} as never, auth as never, {} as never, media as never);
  const response = makeResponse();

  await assert.rejects(controller.media("private-asset", { headers: {} }, response as never), NotFoundException);
  assert.equal(readCalls, 0);
});
