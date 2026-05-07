'use client';

interface FaqItem {
  q: string;
  a: string;
}

interface FaqListProps {
  title: string;
  items: FaqItem[];
}

export function FaqList({ title, items }: FaqListProps) {
  return (
    <section className="py-16 sm:py-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">{title}</h2>
        <div className="space-y-4">
          {items.map((item, i) => (
            <div key={i} className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
              <h3 className="text-sm font-semibold text-white mb-2">Q: {item.q}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
