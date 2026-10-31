export type BankQrSettings = {
  enabled: boolean;
  bankCode: string;
  accountNumber: string;
  accountName: string;
};

export function getVietQrTransferInfo(orderCode: string, bankCode = "") {
  const reference = orderCode.replace(/[^a-z0-9]/gi, "").slice(-46);
  // Keep the configured SePay payment-code prefix attached to its suffix so
  // SePay can extract it into the webhook `code` field.
  const bank = bankCode.trim().toLocaleUpperCase("en");
  const vietinBank = ["ICB", "VIETINBANK", "970415"].includes(bank);
  return `${vietinBank ? "SEVQR " : ""}GEME${reference}`.slice(0, 50);
}

export function getVietQrImageUrl(settings: BankQrSettings, amount: number, orderCode: string) {
  const bankCode = settings.bankCode.trim();
  const accountNumber = settings.accountNumber.trim();
  const accountName = settings.accountName.trim();
  if (!settings.enabled || !/^[a-z0-9.-]{2,20}$/i.test(bankCode) || !/^[0-9]{6,19}$/.test(accountNumber) || !accountName || !Number.isSafeInteger(amount) || amount <= 0 || amount > 9_999_999_999_999) return null;
  const image = new URL("https://vietqr.app/img");
  image.searchParams.set("acc", accountNumber);
  image.searchParams.set("bank", bankCode);
  image.searchParams.set("amount", String(amount));
  image.searchParams.set("des", getVietQrTransferInfo(orderCode, bankCode));
  image.searchParams.set("template", "compact");
  image.searchParams.set("holder", accountName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "D").toLocaleUpperCase("en"));
  return image.toString();
}

