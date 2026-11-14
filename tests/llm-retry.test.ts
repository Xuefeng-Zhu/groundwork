import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { getConfig } from "../server/lib/briefing/config";
import { completeJson } from "../server/lib/briefing/llm";

it("retries once without JSON mode when the provider rejects its own JSON validation", async () => {
  const modes: string[] = [];
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const mode = JSON.parse(raw).response_format?.type;
      modes.push(mode);
      if (mode === "json_object") {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { code: "json_validate_failed", message: "Failed to validate JSON." } }));
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: 'Here: ```json\n{"tldr":[]}\n```' } }] }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const warnings: string[] = [];
  const r = await completeJson({ ...getConfig({}), bifrostUrl: url }, [{ role: "user", content: "x" }], warnings);
  srv.close();
  expect(modes).toEqual(["json_object", "text"]);
  expect(r?.provider).toBe("bifrost");
  expect(warnings[0]).toMatch(/retried once without JSON mode/);
});
