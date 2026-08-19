const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || "";
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  basePath
};

export default nextConfig;
