import { Loader } from "@/components/Loader";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { Marquee } from "@/components/Marquee";
import { Services } from "@/components/Services";
import { Philosophy } from "@/components/Philosophy";
import { Trainers } from "@/components/Trainers";
import { Plans } from "@/components/Plans";
import { Transformations } from "@/components/Transformations";
import { Testimonials } from "@/components/Testimonials";
import { Calculators } from "@/components/Calculators";
import { Nutrition } from "@/components/Nutrition";
import { FAQ } from "@/components/FAQ";
import { Blog } from "@/components/Blog";
import { Contact } from "@/components/Contact";
import { Footer } from "@/components/Footer";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";

export default function Home() {
  return (
    <>
      <Loader />
      <Navbar />
      <main>
        <Hero />
        <Marquee />
        <Services />
        <Philosophy />
        <Trainers />
        <Plans />
        <Transformations />
        <Testimonials />
        <Calculators />
        <Nutrition />
        <FAQ />
        <Blog />
        <Contact />
      </main>
      <Footer />
      <WhatsAppFloat />
    </>
  );
}
