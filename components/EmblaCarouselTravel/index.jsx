import React from "react";
import EmblaCarousel from "./EmblaCarousel";
import Header from "./Header";
import Footer from "./Footer";

const OPTIONS = { dragFree: true, loop: true };

// Define an array of slide objects with iframe content
const SLIDES = [
  {
    image: "/images/800x (5).webp",
    title: "Fourth Slide",
    description: "Description for the fourth slide.",
  },
  {
    image: "/images/800x (6).webp",
    title: "Third Slide",
    description: "Description for the third slide.",
  },
  {
    image: "/images/800x (7).webp",
    title: "Third Slide",
    description: "Description for the third slide.",
  },
  {
    image: "/images/800x (8).webp",
    title: "Fourth Slide",
    description: "Description for the fourth slide.",
  },
  {
    image: "/images/800x (9).webp",
    title: "Fifth Slide",
    description: "Description for the fifth slide.",
  },
  {
    image: "/images/800x (10).webp",
    title: "Fourth Slide",
    description: "Description for the fourth slide.",
  },
];

const App = () => (
  <>
    {/* Uncomment the lines below if you have header and footer components */}
    {/* <Header /> */}
    <EmblaCarousel slides={SLIDES} options={OPTIONS} />
    {/* <Footer /> */}
  </>
);

export default App;
