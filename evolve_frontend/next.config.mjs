/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        unoptimized: true,
        domains: ["localhost"],
    },
    // Expose NEXT_PUBLIC_V2_BACKEND_BASE_URL to the browser
    env: {
        NEXT_PUBLIC_V2_BACKEND_BASE_URL: process.env.NEXT_PUBLIC_V2_BACKEND_BASE_URL,
    },
};

export default nextConfig;
