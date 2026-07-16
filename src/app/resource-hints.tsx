"use client";

import ReactDOM from "react-dom";

export function ResourceHints() {
  ReactDOM.preconnect("https://cdn.jsdelivr.net", { crossOrigin: "anonymous" });
  ReactDOM.prefetchDNS("https://cdn.jsdelivr.net");
  return null;
}
