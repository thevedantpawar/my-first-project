import { posts } from "@/lib/site";
import { ArrowIcon } from "./Icons";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";

export function Blog() {
  return (
    <section
      id="blog"
      className="relative border-t border-white/5 bg-ink-soft py-24 sm:py-32"
    >
      <div className="shell">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            eyebrow="Journal"
            title={
              <>
                Evidence, <span className="text-lime">explained</span>
              </>
            }
            intro="Practical, science-backed reading on training, nutrition and health."
          />
          <Reveal>
            <a href="#" className="btn-ghost">
              View all articles
              <ArrowIcon className="h-4 w-4" />
            </a>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {posts.map((post, i) => (
            <Reveal as="article" key={post.title} delay={i * 0.08}>
              <a
                href="#"
                className="group glass block h-full overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-lime/40"
              >
                <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-gradient-to-br from-white/[0.06] to-transparent">
                  <span className="font-display text-5xl font-bold text-white/[0.06]">
                    Rx
                  </span>
                  <span className="absolute left-4 top-4 rounded-full bg-lime px-3 py-1 text-[11px] font-semibold text-ink">
                    {post.tag}
                  </span>
                </div>
                <div className="p-6">
                  <div className="text-xs text-white/40">{post.read} read</div>
                  <h3 className="mt-2 font-display text-lg font-semibold leading-snug transition-colors group-hover:text-lime">
                    {post.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/55">
                    {post.excerpt}
                  </p>
                  <div className="mt-4 flex items-center gap-2 text-sm font-medium text-lime">
                    Read article
                    <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
