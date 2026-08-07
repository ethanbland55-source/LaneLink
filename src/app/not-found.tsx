import Link from "next/link";

export default function NotFound() {
  return (
    <section className="bg-deep lane-lines text-white min-h-[65vh] flex items-center">
      <div className="container-page py-20 text-center">
        <p className="eyebrow text-gold-400">404</p>
        <h1 className="mt-4 text-white text-[clamp(2rem,5vw,3.2rem)]">
          That page has swum off
        </h1>
        <p className="mt-5 text-brand-100/85 max-w-lg mx-auto">
          The link may be from the old site, or the page may have moved. Try the results archive or
          head back to the front page.
        </p>
        <div className="mt-9 flex flex-wrap gap-3 justify-center">
          <Link href="/" className="btn btn-primary">Back to the home page</Link>
          <Link href="/results" className="btn btn-onDark">Gala results</Link>
        </div>
      </div>
    </section>
  );
}
