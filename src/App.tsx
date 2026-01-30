import { useState, useEffect } from "react";

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import Header from "./components/header/header";
import Reader from "./components/url_reader/reader";
import Generator from "./components/qr_code_generator/generator";
import Footer from "./components/footer/footer";
import "./App.css";

function App() {
  const [] = useState("");

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-[#1a1a1a] text-zinc-900 dark:text-zinc-200 font-sans transition-colors duration-300">
      <Header />
      <main className="flex-1 overflow-hidden"></main>
      <Footer />
    </div>
  );
}

export default App;
