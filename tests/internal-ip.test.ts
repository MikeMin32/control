import { describe, expect, it } from "vitest";
import {
  isValidIpv4,
  normalizeOptionalIpv4,
  parseSuggestableVmid,
  suggestedInternalIp,
} from "../src/lib/internal-ip";

describe("suggestedInternalIp", () => {
  it("generates 192.168.{vmid}.10 for VMIDs 1–254", () => {
    expect(suggestedInternalIp(120)).toBe("192.168.120.10");
    expect(suggestedInternalIp("202")).toBe("192.168.202.10");
    expect(suggestedInternalIp(1)).toBe("192.168.1.10");
    expect(suggestedInternalIp(254)).toBe("192.168.254.10");
  });

  it("returns null outside 1–254 or for non-integers", () => {
    expect(suggestedInternalIp(777)).toBeNull();
    expect(suggestedInternalIp(0)).toBeNull();
    expect(suggestedInternalIp(255)).toBeNull();
    expect(suggestedInternalIp("")).toBeNull();
    expect(suggestedInternalIp("12a")).toBeNull();
    expect(suggestedInternalIp(12.5)).toBeNull();
    expect(suggestedInternalIp(null)).toBeNull();
  });
});

describe("parseSuggestableVmid", () => {
  it("accepts only integer strings/numbers in range", () => {
    expect(parseSuggestableVmid("120")).toBe(120);
    expect(parseSuggestableVmid(7)).toBe(7);
    expect(parseSuggestableVmid("777")).toBeNull();
  });
});

describe("isValidIpv4 / normalizeOptionalIpv4", () => {
  it("accepts dotted-quad IPv4 including non-suggested subnets", () => {
    expect(isValidIpv4("192.168.250.10")).toBe(true);
    expect(isValidIpv4("10.0.0.1")).toBe(true);
    expect(normalizeOptionalIpv4(" 192.168.250.10 ")).toBe("192.168.250.10");
  });

  it("treats empty as null and rejects invalid", () => {
    expect(normalizeOptionalIpv4("")).toBeNull();
    expect(normalizeOptionalIpv4("   ")).toBeNull();
    expect(normalizeOptionalIpv4(null)).toBeNull();
    expect(isValidIpv4("192.168.777.10")).toBe(false);
    expect(isValidIpv4("not-an-ip")).toBe(false);
    expect(() => normalizeOptionalIpv4("999.1.1.1")).toThrow("INVALID_IPV4");
  });
});
