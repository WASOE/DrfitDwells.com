import Image from "next/image";
import { Container } from "@/components/layout/Container";

type PartnerCategory = {
  title: string;
  image: string;
};

// Keep layout and sizing stable; focus on polish + motion.
const categories: PartnerCategory[] = [
  {
    title: "Intergovernmental Organizations",
    image: "/images/banskolab/activities/20211121_151250-scaled.jpg",
  },
  {
    title: "Central and Local Authorities",
    image: "/images/banskolab/activities/10c335fb-5ea2-4dbc-8f34-f8d7386d7ecf.jpg",
  },
  {
    title: "Non-Governmental Organizations",
    image: "/images/banskolab/activities/20211121_152220-scaled.jpg",
  },
  {
    title: "Academia",
    image: "/images/banskolab/activities/20211121_162325-scaled.jpg",
  },
  {
    title: "Media",
    image: "/images/banskolab/activities/20211107_150116-scaled.jpg",
  },
  {
    title: "Private sector",
    image: "/images/banskolab/activities/75ede2fb-6bfa-461d-9082-38a09830c1b3.jpg",
  },
];

export function PartnerCategoryTiles() {
  return (
    <Container>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <div key={category.title} className="group">
            <div className="relative h-56 w-full overflow-hidden rounded-2xl bg-ink/5">
              <Image
                src={category.image}
                alt={category.title}
                width={640}
                height={480}
                className="h-full w-full object-cover transition-transform duration-300 will-change-transform group-hover:scale-[1.03]"
              />
              <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 [background:radial-gradient(1200px_circle_at_20%_10%,rgba(255,255,0,0.12),transparent_55%)]" />
            </div>
            <div className="pt-4">
              <h3 className="text-left text-sm font-semibold uppercase tracking-wider text-ink">
                {category.title}
              </h3>
            </div>
          </div>
        ))}
      </div>
    </Container>
  );
}

