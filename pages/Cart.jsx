// pages/cart.tsx
import { useCart } from "../components/context/CartContext";
import Layout from "./Layout";
import Image from "next/image";
import Link from "next/link";
import SwiperCard from "../components/SwiperCarousel/AnotherProduct";
import { useState, useEffect } from "react";
import CheckoutForm from "../components/CheckoutForm";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import { motion, AnimatePresence } from "framer-motion";

const steps = ["購物車", "填寫資料", "完成訂單"];

const CartPage = () => {
  const { cartItems, totalPrice, updateQuantity, removeFromCart } = useCart();
  const [activeStep, setActiveStep] = useState(0);
  const [removingIndex, setRemovingIndex] = useState(null);
  const [orderStatus, setOrderStatus] = useState(null);

  const handleNext = () => setActiveStep((prev) => prev + 1);
  const handleBack = () => setActiveStep((prev) => prev - 1);

  const handleRemoveWithAnimation = (index, id, color, size) => {
    setRemovingIndex(index);
    setTimeout(() => {
      removeFromCart(id, color, size);
      setRemovingIndex(null);
    }, 300);
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const orderNo = urlParams.get("orderNo");
    if (orderNo) {
      fetch(`/api/order-status-for-cart?orderNo=${orderNo}`)
        .then((res) => res.json())
        .then((data) => setOrderStatus(data))
        .catch((err) => console.error("查詢訂單失敗", err));
    }
  }, []);

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="pt-[200px] bg-[#f5f6f7] px-[30px] w-full mx-auto">
          <Box sx={{ width: "100%" }}>
            <Stepper activeStep={activeStep} alternativeLabel>
              {steps.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>
          </Box>

          <AnimatePresence mode="wait">
            {/* -------- Step 0：購物車 -------- */}
            {activeStep === 0 && (
              <motion.div
                key="step-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-7xl mx-auto py-12"
              >
                <div className="cart-title flex justify-between items-center w-full flex-wrap gap-2">
                  <h1 className="text-3xl font-bold mb-2 sm:mb-6">
                    您的購物車
                  </h1>
                  <Link
                    href="/"
                    className="text-blue-600 hover:underline text-sm sm:text-base"
                  >
                    繼續選購商品
                  </Link>
                </div>

                {/* 標題列 (桌機) */}
                <div className="hidden sm:flex w-full border-b border-gray-300 pb-2 text-gray-700 text-[.9rem]">
                  <div className="w-[10%]">商品</div>
                  <div className="w-[50%]" />
                  <div className="w-[20%] text-center">數量</div>
                  <div className="w-[20%] text-center">小計</div>
                </div>

                {cartItems.length === 0 ? (
                  <p className="mt-6 text-gray-600 text-center">
                    您的購物車是空的
                  </p>
                ) : (
                  <div className="space-y-6 pt-4 pb-[100px] w-full">
                    {cartItems.map((item, index) => (
                      <motion.div
                        key={item.id + item.color + item.size}
                        initial={{ opacity: 1, x: 0 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 300 }}
                        transition={{ duration: 0.3 }}
                        className="flex sm:flex-row flex-col w-full bg-white rounded-lg px-4 py-6 border border-gray-200 shadow-sm"
                      >
                        {/* 商品圖片 */}
                        <div className="sm:w-[10%] w-full flex justify-center sm:justify-start mb-4 sm:mb-0">
                          <Image
                            src={item.image}
                            width={100}
                            height={100}
                            alt={item.name}
                            className="rounded max-w-[120px] h-auto"
                          />
                        </div>

                        {/* 商品資訊 */}
                        <div className="sm:w-[50%] w-full flex flex-col justify-center sm:pl-8 mb-4 sm:mb-0 text-center sm:text-left">
                          <h2 className="font-bold text-[1rem] sm:text-[1.1rem]">
                            {item.name}
                          </h2>
                          <div className="flex justify-center sm:justify-start text-gray-600 text-[.85rem] mt-1">
                            <p className="mr-2">{item.color}</p>
                            <p>{item.size}</p>
                          </div>
                        </div>

                        {/* 數量控制 */}
                        <div className="sm:w-[20%] w-full flex justify-center sm:justify-start items-center mb-3 sm:mb-0">
                          <div className="flex items-center border rounded-full px-3 py-1">
                            <button
                              className="w-7 h-7 text-[1.2rem] flex items-center justify-center"
                              onClick={() =>
                                updateQuantity(
                                  item.id,
                                  item.color,
                                  item.size,
                                  item.quantity - 1
                                )
                              }
                            >
                              -
                            </button>
                            <span className="w-8 text-center text-[1rem]">
                              {item.quantity}
                            </span>
                            <button
                              className="w-7 h-7 text-[1.2rem] flex items-center justify-center"
                              onClick={() =>
                                updateQuantity(
                                  item.id,
                                  item.color,
                                  item.size,
                                  item.quantity + 1
                                )
                              }
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* 價格與移除 */}
                        <div className="sm:w-[20%] w-full flex flex-col sm:flex-row justify-center sm:justify-between items-center sm:items-center">
                          <p className="text-gray-800 text-[.9rem] sm:text-base mb-1 sm:mb-0">
                            單價: ${item.price}
                          </p>
                          <button
                            className="text-red-500 hover:text-red-600 text-sm"
                            onClick={() =>
                              handleRemoveWithAnimation(
                                index,
                                item.id,
                                item.color,
                                item.size
                              )
                            }
                          >
                            移除
                          </button>
                        </div>
                      </motion.div>
                    ))}

                    {/* 總金額 */}
                    <div className="text-right text-xl font-bold mt-6">
                      訂單總金額: ${totalPrice}
                    </div>

                    {/* 下一步按鈕 */}
                    <div className="flex justify-end mt-8">
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={handleNext}
                        className="rounded-full text-lg"
                      >
                        下一步
                      </Button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* -------- Step 1：填寫資料 -------- */}
            {activeStep === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              >
                <CheckoutForm onBack={handleBack} onNext={handleNext} />
              </motion.div>
            )}

            {/* -------- Step 2：完成訂單 -------- */}
            {activeStep === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="max-w-2xl mx-auto px-4 py-20 text-center"
              >
                <h1 className="text-2xl font-bold mb-4">感謝您的訂購</h1>
                {orderStatus ? (
                  <div className="space-y-3 text-sm sm:text-base">
                    <p>付款狀態：{orderStatus.status}</p>
                    <p>訂單編號：{orderStatus.orderNo}</p>
                    <p>付款方式：{orderStatus.payment_method_title}</p>
                    <p>付款時間：{orderStatus.date_paid}</p>
                    {orderStatus.qrcode && (
                      <>
                        <p className="mt-4">請掃描下方 QRCode 啟用 eSIM</p>
                        <img
                          src={orderStatus.qrcode}
                          alt="eSIM QRCode"
                          className="max-w-[220px] sm:max-w-[250px] mx-auto"
                        />
                      </>
                    )}
                  </div>
                ) : (
                  <p>正在查詢訂單資訊...</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 推薦商品輪播 */}
        <div>
          <SwiperCard />
        </div>
      </motion.div>
    </Layout>
  );
};

export default CartPage;
