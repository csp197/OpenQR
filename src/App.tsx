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
    <div>
    <Header />
    <Reader />
    <Generator />
    <Footer />
    </div>
  );
}

export default App;
