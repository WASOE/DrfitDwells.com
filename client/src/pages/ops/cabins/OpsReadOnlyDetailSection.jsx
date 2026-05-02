export default function OpsReadOnlyDetailSection({ title, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 max-w-4xl mx-auto w-full">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-3 text-xs text-gray-700 space-y-2">{children}</div>
    </section>
  );
}
