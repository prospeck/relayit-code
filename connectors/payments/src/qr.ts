import QRCode from "qrcode";

export async function upiQrSvg(
  uri: string,
  colors: { dark?: string; light?: string } = {},
): Promise<string> {
  const svg = await QRCode.toString(uri, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: colors,
  });
  return svg.replace(/\s(?:width|height)="[^"]*"/g, "").trim();
}
