import {
  SERVICE_NAME,
  SERVICE_RUNTIME,
  SERVICE_VERSION,
} from "../config/constants";
import { json } from "../http/response";

export function handleHealth(): Response {
  return json({
    ok: true,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    status: "online",
    runtime: SERVICE_RUNTIME,
    timestamp: new Date().toISOString(),
  });
}
