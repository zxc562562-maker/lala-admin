/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // 패키징 완료 사진 업로드(최대 8MB)가 기본 1MB 제한을 넘어서 늘려둠.
      bodySizeLimit: '10mb',
    },
  },
  transpilePackages: ['@lala/shared'],
};
export default nextConfig;
