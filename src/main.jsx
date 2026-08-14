import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// GA4。測定IDはアプリごとに異なるためビルド時の環境変数で渡す。
// 未設定なら何も注入しない（壊れたIDを埋め込まないため）。
const GA4_ID = import.meta.env.VITE_GA4_ID;
if (GA4_ID) {
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA4_ID);
}

// 解説ページの本文は #root の外（article.page-content）にあり、Reactは触らない。
// 運営者情報やプライバシーのように計算機を出さないページには #root 自体が無いので、
// 存在チェックをしてから描く。
const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
