// pages/_app.js
import '../src/globals.css'; // 确保路径正确
import { NextUIProvider } from '@nextui-org/react'; // 如果使用 NextUI 的 Provider
import { AuthProvider } from '../components/AuthProvider';

import { CartProvider } from "../components/context/CartContext"; // 引入 CartProvider

function MyApp({ Component, pageProps }) {
  return (
    <AuthProvider>
    <NextUIProvider>
    <CartProvider>
    
      <Component {...pageProps} />
     
        </CartProvider>
        
    </NextUIProvider>
    </AuthProvider>
  );
}

export default MyApp;
