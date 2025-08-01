// pages/cart.tsx
import { useCart } from "../components/context/CartContext";
import Layout from "./Layout";
import Image from "next/image";
import Link from "next/link";
import SwiperCard from "../components/SwiperCarousel/AnotherProduct";
import { useState, useEffect } from "react";
import CheckoutPage from "./checkout";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import CheckoutForm from "../components/CheckoutForm";
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

  const handleNext = () => {
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  const handleRemoveWithAnimation = (index, id, color, size) => {
    setRemovingIndex(index);
    setTimeout(() => {
      removeFromCart(id, color, size);
      setRemovingIndex(null);
    }, 300);
  };

  // 取得網址參數中的 orderNo
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
        <div className="title"></div>
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
            {activeStep === 0 && (
              <motion.div
                key="step-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-7xl mx-auto py-12"
              >
                <div className="cart-title flex justify-between w-full mx-auto">
                  <h1 className="text-3xl font-bold mb-6">您的購物車</h1>
                  <Link href="">繼續選購商品</Link>
                </div>
                <div className="flex w-full">
                  <div className="w-[10%]">
                    <span className="text-[.9rem] text-gray-700">商品</span>
                  </div>
                  <div className="w-[50%]" />
                  <div className="w-[20%]">
                    <span className="text-[.9rem] text-gray-700">數量</span>
                  </div>
                  <div className="w-[20%]">
                    <span className="text-[.9rem] text-gray-700">小計</span>
                  </div>
                </div>
                {cartItems.length === 0 ? (
                  <p>您的購物車是空的</p>
                ) : (
                  <div className="space-y-6 pt-2 pb-[100px] w-full">
                    {cartItems.map((item, index) => (
                      <motion.div
                        key={item.id + item.color + item.size}
                        initial={{ opacity: 1, x: 0 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 300 }}
                        transition={{ duration: 0.3 }}
                        className="flex w-full bg-white rounded-lg px-4 py-8 border-b-1 border-gray-300"
                      >
                        <div className="w-[10%]">
                          <img
                            src={item.image}
                            width={100}
                            height={100}
                            alt={item.name}
                            className="rounded max-w-[100px] h-auto"
                          />
                        </div>
                        <div className="w-[50%] flex flex-col justify-center pl-8">
                          <h2 className="font-bold text-[1.1rem] text-left">
                            {item.name}
                          </h2>
                          <div className="flex">
                            <p className="text-[.8rem] mr-2 text-gray-600">
                              {item.color}
                            </p>
                            <p className="text-[.8rem] text-gray-600">
                              {item.size}
                            </p>
                          </div>
                        </div>
                        <div className="w-[20%]">
                          <div className="flex w-full justify-start items-center h-full">
                            <div className="flex items-center border rounded-full px-2 mt-2">
                              <button
                                className="w-8 h-8 text-[1.2rem] flex items-center justify-center"
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
                              <span className="w-8 text-center text-[1.1rem]">
                                {item.quantity}
                              </span>
                              <button
                                className="w-8 h-8 text-[1.2rem] flex items-center justify-center"
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
                        </div>
                        <div className="w-[20%] flex items-center justify-between">
                          <p>單價: ${item.price}</p>
                          <button
                            className="text-red-500 mt-2"
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
                    <div className="text-right text-xl font-bold">
                      訂單總金額: ${totalPrice}
                    </div>
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

            {activeStep === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="max-w-2xl mx-auto px-4 py-20"
              >
                <h1 className="text-2xl font-bold mb-4">感謝您的訂購</h1>
                {orderStatus ? (
                  <div className="space-y-3">
                    <p>付款狀態：{orderStatus.status}</p>
                    <p>訂單編號：{orderStatus.orderNo}</p>
                    <p>付款方式：{orderStatus.payment_method_title}</p>
                    <p>付款時間：{orderStatus.date_paid}</p>
                    {orderStatus.qrcode && (
                      <>
                        <p>請掃描下方 QRCode 啟用 eSIM</p>
                        <img
                          src={orderStatus.qrcode}
                          alt="eSIM QRCode"
                          className="max-w-[250px]"
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
        <div>
          <SwiperCard />
        </div>
      </motion.div>
    </Layout>
  );
};

export default CartPage;
