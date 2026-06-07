import {
  BUILD_MODELS,
  CUSTOM_SIZING,
  getIncludedItemsForModel,
} from '../../data/buildConfiguratorSchema.js';
import {
  computeCustomSizePrice,
  formatBuildPrice,
} from '../../data/buildConfiguratorLogic.js';
import { getBuildHeroImageUrl } from '../../data/buildMediaLibrary.js';

const BuildModelStep = ({ state, model, onSelectModel, onCustomDimensionsChange, padX = 'px-8', hideHeader = false }) => {
  const custom = state.customDimensions ?? {
    length: CUSTOM_SIZING.length.default,
    width: CUSTOM_SIZING.width.default,
  };
  const isCabin = model.type === 'cabin';
  const customPricing = isCabin
    ? computeCustomSizePrice(model.basePrice, custom.length, custom.width)
    : null;

  return (
    <>
      {!hideHeader ? (
      <div className={`${padX} pt-8`}>
        <h2 className="mb-1.5 font-serif text-[2rem] font-normal leading-tight text-[#1a1a1a]">
          Choose your model
        </h2>
        <p className="text-[0.8rem] leading-relaxed text-[#9a9a9a]">
          Cabin models from €30,000 all-inclusive. A-Frame shell from €20,000. Delivered and
          installed. No surprises on structural scope.
        </p>
      </div>
      ) : null}

      <div className={`flex flex-col gap-3 ${padX} ${hideHeader ? 'pt-2' : ''} pb-5`}>
        {BUILD_MODELS.map((item) => {
          const selected = state.modelId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectModel(item.id)}
              className={`overflow-hidden rounded-[2px] border bg-white text-left transition-colors ${
                selected ? 'border-[#1a1a1a] border-[1.5px]' : 'border-[#e0e0e0] hover:border-[#bbb]'
              }`}
            >
              <img
                src={getBuildHeroImageUrl(item.id)}
                alt={item.name}
                className="block h-40 w-full object-cover"
              />
              <div className="relative p-5">
                {selected ? (
                  <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[#1a1a1a] text-white">
                    ✓
                  </div>
                ) : null}
                <div className="mb-2 text-[0.58rem] font-medium uppercase tracking-[0.14em] text-[#9a9a9a]">
                  {item.badge}
                </div>
                <div className="mb-1 font-serif text-[1.4rem] font-normal text-[#1a1a1a]">
                  {item.name}
                </div>
                <div className="mb-3 text-[0.74rem] leading-relaxed text-[#5a5a5a]">
                  {item.dims} · {item.areaLabel} · {item.capacity}
                  <br />
                  {item.description}
                </div>
                <div className="font-serif text-[1.5rem] font-light text-[#1a1a1a]">
                  {formatBuildPrice(item.basePrice)}{' '}
                  <small className="font-sans text-[0.68rem] font-normal text-[#9a9a9a]">
                    {item.shellOnly ? 'shell price' : 'all-inclusive'}
                  </small>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-[2px] border border-[#e0e0e0] px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.08em] text-[#9a9a9a]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className={`${padX} mb-6 rounded-[2px] border border-[#e0e0e0] bg-[#faf9f7] p-5`}>
        <div className="mb-4 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-[#9a9a9a]">
          Structural shell included
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-x-4">
          {getIncludedItemsForModel(state.modelId).map((line) => (
            <div key={line} className="flex items-start gap-2 text-[0.76rem] text-[#5a5a5a]">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#1a1a1a]" />
              {line}
            </div>
          ))}
        </div>
      </div>

      {isCabin ? (
        <div className={`${padX} mb-6 rounded-[2px] border border-[#e0e0e0] bg-white p-6`}>
          <div className="mb-1 font-serif text-[1.2rem] font-normal text-[#1a1a1a]">
            Need a custom size?
          </div>
          <p className="mb-5 text-[0.76rem] leading-relaxed text-[#9a9a9a]">
            Going bigger? We calculate extra area at €1,200/m² above 21m². Going smaller? The
            price stays at €30,000.
          </p>
          <div className="mb-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[0.62rem] uppercase tracking-[0.1em] text-[#9a9a9a]">
                Length
              </span>
              <span className="mb-1 block font-serif text-[1.3rem] text-[#1a1a1a]">
                {custom.length} m
              </span>
              <input
                type="range"
                min={CUSTOM_SIZING.length.min}
                max={CUSTOM_SIZING.length.max}
                step={CUSTOM_SIZING.length.step}
                value={custom.length}
                onChange={(e) =>
                  onCustomDimensionsChange({
                    length: Number(e.target.value),
                    width: custom.width,
                  })
                }
                className="w-full accent-[#1a1a1a]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[0.62rem] uppercase tracking-[0.1em] text-[#9a9a9a]">
                Width
              </span>
              <span className="mb-1 block font-serif text-[1.3rem] text-[#1a1a1a]">
                {custom.width} m
              </span>
              <input
                type="range"
                min={CUSTOM_SIZING.width.min}
                max={CUSTOM_SIZING.width.max}
                step={CUSTOM_SIZING.width.step}
                value={custom.width}
                onChange={(e) =>
                  onCustomDimensionsChange({
                    length: custom.length,
                    width: Number(e.target.value),
                  })
                }
                className="w-full accent-[#1a1a1a]"
              />
            </label>
          </div>
          <div className="flex items-baseline justify-between border-t border-[#e0e0e0] pt-4">
            <span className="text-[0.72rem] text-[#9a9a9a]">{customPricing.label}</span>
            <span className="font-serif text-[1.4rem] font-light text-[#1a1a1a]">
              {formatBuildPrice(customPricing.total)}
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default BuildModelStep;
