// Approximate geographic centres (latitude, longitude) of countries, keyed by ISO 3166-1 alpha-2.
// Used to place webhook-origin markers on the landing-page globe.
const RAW =
  "US:39,-98 CA:57,-101 MX:23,-102 BR:-10,-53 AR:-34,-64 CL:-31,-71 CO:4,-73 PE:-10,-76 VE:7,-66 EC:-1,-78 UY:-33,-56 " +
  "GB:54,-2 IE:53,-8 FR:46,2 DE:51,10 NL:52,5 BE:50,4 LU:49.8,6.1 CH:47,8 AT:47.5,14.5 ES:40,-4 PT:39.5,-8 IT:42.8,12.8 " +
  "SE:62,15 NO:62,10 DK:56,10 FI:64,26 IS:65,-18 PL:52,19 CZ:49.8,15.5 SK:48.7,19.7 HU:47,20 RO:46,25 BG:43,25 GR:39,22 " +
  "UA:49,32 BY:53,28 LT:55.3,24 LV:57,25 EE:59,26 RU:61,99 TR:39,35 IL:31.5,35 AE:24,54 SA:24,45 QA:25.3,51.2 KW:29.3,47.6 " +
  "EG:27,30 MA:32,-6 NG:9,8 GH:8,-1 KE:0.5,38 ZA:-29,24 ET:9,39 TZ:-6,35 " +
  "IN:22,79 PK:30,70 BD:24,90 LK:7.8,80.7 NP:28,84 CN:35,103 HK:22.3,114.2 TW:23.7,121 JP:36,138 KR:36,128 " +
  "SG:1.35,103.8 MY:4,102 TH:15,101 VN:16,107 ID:-2,118 PH:12,122 AU:-25,134 NZ:-41,174";

export const COUNTRY_CENTRE: Record<string, [number, number]> = Object.fromEntries(
  RAW.split(" ").map((e) => {
    const [code, ll] = e.split(":");
    const [lat, lon] = ll.split(",").map(Number);
    return [code, [lat, lon]];
  }),
);

/** Country name for an ISO code, in the visitor's language (falls back to the code). */
export function countryName(code: string) {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
