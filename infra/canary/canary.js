const { URL } = require("url");
const synthetics = require("Synthetics");

// Anything outside 2xx fails the step (and the canary run).
const validateStatus = async (res) => {
  if (res.statusCode < 200 || res.statusCode > 299) {
    throw new Error(`${res.statusCode} ${res.statusMessage}`);
  }
};

const availabilityCanary = async function () {
  const stepConfig = {
    includeRequestHeaders: false,
    includeResponseHeaders: false,
    includeRequestBody: false,
    includeResponseBody: false,
    retry: 0,
    // Default is true, which logs a step failure but lets the run
    // continue and report an overall PASS — verified against a live
    // outage during a game day (2026-07-29): a 503 from /health showed
    // up as a FAILED step in the logs while CanaryName SuccessPercent
    // stayed at 100 and CanaryFailedAlarm never fired.
    continueOnHttpStepFailure: false,
  };

  const checks = [
    { name: "apiHealth", url: process.env.HEALTH_URL },
    { name: "frontend", url: process.env.SITE_URL },
  ];

  for (const check of checks) {
    const requestOptions = new URL(check.url);
    requestOptions.method = "GET";
    requestOptions.headers = {
      "User-Agent": synthetics.getCanaryUserAgentString(),
    };

    await synthetics.executeHttpStep(
      check.name,
      requestOptions,
      validateStatus,
      stepConfig,
    );
  }
};

exports.handler = async () => {
  return await availabilityCanary();
};
