// Brand logo lives in /public/logo-icon.png (white mark on a black rounded tile, works on light and dark).
export function LogoMark({ size = 24 }: { size?: number }) {
  return <img src="/logo-icon.png" width={size} height={size} alt="" style={{ display: "block", borderRadius: size * 0.22 }} />;
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="lp-logo">
      <LogoMark size={size} />
      <span>EaseWebhook</span>
    </span>
  );
}
