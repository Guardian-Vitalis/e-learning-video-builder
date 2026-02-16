export function dataUrlToBase64(dataUrl: string): string {
  if (!dataUrl) {
    return "";
  }
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    return dataUrl;
  }
  return dataUrl.slice(commaIndex + 1);
}
