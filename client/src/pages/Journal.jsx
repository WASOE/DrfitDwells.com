const Journal = () => {
  // Placeholder blog posts
  const posts = [
    { id: 1, title: 'Coming Soon', excerpt: 'Journal entries will appear here...' },
    { id: 2, title: 'Coming Soon', excerpt: 'Stories from the mountains...' },
    { id: 3, title: 'Coming Soon', excerpt: 'Guest experiences and reflections...' }
  ];

  return (
    <div className="min-h-screen bg-[#F1ECE2]">
      {/* Hero Section */}
      <section className="relative py-20 md:py-32">
        <div className="max-w-4xl mx-auto px-4 md:px-8 text-center">
          <h1 className="font-['Playfair_Display'] text-4xl md:text-6xl text-stone-900 font-semibold tracking-tight leading-tight mb-6">
            Journal
          </h1>
          <p className="font-['Merriweather'] text-lg md:text-xl text-stone-700 leading-relaxed max-w-2xl mx-auto">
            Stories, reflections, and moments from the mountains.
          </p>
        </div>
      </section>

      {/* Blog Posts List */}
      <section className="py-12 md:py-20">
        <div className="max-w-4xl mx-auto px-4 md:px-8">
          <div className="space-y-8">
            {posts.map((post) => (
              <article
                key={post.id}
                className="bg-white/60 rounded-xl p-6 md:p-8 border border-stone-200/50 hover:border-stone-300 transition-colors"
              >
                <h2 className="font-['Playfair_Display'] text-2xl md:text-3xl text-stone-900 mb-3">
                  {post.title}
                </h2>
                <p className="font-['Merriweather'] text-stone-600 leading-relaxed">
                  {post.excerpt}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Journal;





























