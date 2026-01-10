export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  let deviceId = localStorage.getItem("skylog_device_id");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("skylog_device_id", deviceId);
  }
  return deviceId;
}
