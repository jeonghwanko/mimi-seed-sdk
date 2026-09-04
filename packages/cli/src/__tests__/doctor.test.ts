import { describe, expect, it } from "vitest";
import { manifestCredentialMismatch } from "../doctor.js";

describe("doctor manifest credential identity", () => {
  it("매니페스트가 요구한 App Store keyId와 현재 연결을 비교한다", () => {
    expect(manifestCredentialMismatch(
      "appstore",
      { keyId: "EXPECTED_KEY" },
      { keyId: "CURRENT_KEY" },
    )).toEqual({ field: "keyId", expected: "EXPECTED_KEY", actual: "CURRENT_KEY" });
  });

  it("특정 키를 요구하지 않거나 일치하면 통과한다", () => {
    expect(manifestCredentialMismatch("appstore", {}, { keyId: "CURRENT_KEY" })).toBeNull();
    expect(manifestCredentialMismatch(
      "appstore",
      { keyId: "CURRENT_KEY", issuerId: "ISSUER" },
      { keyId: "CURRENT_KEY", issuerId: "ISSUER" },
    )).toBeNull();
  });

  it("요구한 issuerId가 현재 자격증명에 없으면 불일치로 처리한다", () => {
    expect(manifestCredentialMismatch(
      "appstore",
      { issuerId: "EXPECTED_ISSUER" },
      { keyId: "CURRENT_KEY" },
    )).toEqual({ field: "issuerId", expected: "EXPECTED_ISSUER", actual: undefined });
  });
});
