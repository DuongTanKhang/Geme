export const formatStorePrice = (price: number) => `${new Intl.NumberFormat("vi-VN").format(price)} ₫`;
