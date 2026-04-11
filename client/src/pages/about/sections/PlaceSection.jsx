import ArchiveGallery from './ArchiveGallery';

const PlaceSection = () => {
  // All archive images from the build
  const archiveImages = [
    {
      src: '/uploads/Bucephalus building stage/IMG_20210513_124853_586-scaled.jpg.bv.webp',
      caption: 'The place. Before it had a name.',
      alt: 'Early stage of the build site'
    },
    {
      src: '/uploads/Bucephalus building stage/WhatsApp Image 2026-02-22 at 2.51.36 PM.jpeg',
      caption: 'One wall left.',
      alt: 'Building progress with one wall remaining'
    },
    {
      src: '/uploads/Bucephalus building stage/WhatsApp Image 2026-02-22 at 2.51.36 PM (1).jpeg',
      caption: 'Life was happening outside while I was building inside.',
      alt: 'Building process during construction'
    },
    {
      src: '/uploads/Bucephalus building stage/WhatsApp Image 2026-02-22 at 2.51.36 PM (2).jpeg',
      caption: 'Simple. Warm. Built for sleep.',
      alt: 'Interior of the finished cabin'
    },
    {
      src: '/uploads/Bucephalus building stage/WhatsApp Image 2026-02-22 at 2.51.37 PM.jpeg',
      caption: 'First comforts, built from scratch.',
      alt: 'Early interior details'
    },
    {
      src: '/uploads/Bucephalus building stage/WhatsApp Image 2026-02-22 at 2.51.37 PM (1).jpeg',
      caption: 'Most days were just this.',
      alt: 'Daily building routine'
    }
  ];

  return (
    <section className="valley-section">
      <div className="valley-container">
        <div className="max-w-[700px] mx-auto">
          <ArchiveGallery images={archiveImages} />
        </div>
      </div>
    </section>
  );
};

export default PlaceSection;
