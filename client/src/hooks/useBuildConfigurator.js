import { useCallback, useMemo, useState } from 'react';
import {
  computeBuildTotal,
  createInitialBuildState,
  formatBuildBarPrice,
  getDisplayArea,
  getDisplayDimensions,
  getOptionById,
  sanitizeBuildState,
} from '../data/buildConfiguratorLogic.js';
import { getBuildHeroImageUrl, getBuildMediaEntry } from '../data/buildMediaLibrary.js';
import { BUILD_STEPS, getBuildModel } from '../data/buildConfiguratorSchema.js';

export function useBuildConfigurator(initialModelId) {
  const [state, setState] = useState(() => createInitialBuildState(initialModelId));
  const [currentStep, setCurrentStep] = useState(0);
  const [heroMediaId, setHeroMediaId] = useState(() => getBuildModel(initialModelId).heroMediaId);

  const pricing = useMemo(() => computeBuildTotal(state), [state]);
  const barPrice = useMemo(() => formatBuildBarPrice(pricing), [pricing]);
  const model = useMemo(() => getBuildModel(state.modelId), [state.modelId]);

  const selectModel = useCallback((modelId) => {
    setState((prev) => sanitizeBuildState({ ...prev, modelId }, modelId));
    const nextModel = getBuildModel(modelId);
    setHeroMediaId(nextModel.heroMediaId);
  }, []);

  const setCustomDimensions = useCallback((customDimensions) => {
    setState((prev) => ({ ...prev, customDimensions }));
  }, []);

  const selectRadio = useCallback((categoryId, optionId) => {
    setState((prev) => {
      const opt = getOptionById(optionId);
      const currentModel = getBuildModel(prev.modelId);
      setHeroMediaId(opt?.mediaId ?? currentModel.heroMediaId);
      return {
        ...prev,
        radio: { ...prev.radio, [categoryId]: optionId },
      };
    });
  }, []);

  const toggleOption = useCallback((optionId) => {
    setState((prev) => ({
      ...prev,
      toggles: prev.toggles.includes(optionId)
        ? prev.toggles.filter((id) => id !== optionId)
        : [...prev.toggles, optionId],
    }));
  }, []);

  const setHeroFromOption = useCallback(
    (mediaId) => {
      if (mediaId) setHeroMediaId(mediaId);
    },
    []
  );

  const goToStep = useCallback((stepIndex) => {
    if (stepIndex < 0 || stepIndex >= BUILD_STEPS.length) return;
    if (stepIndex > currentStep + 1 && stepIndex !== BUILD_STEPS.length - 1) return;
    setCurrentStep(stepIndex);
  }, [currentStep]);

  const nextStep = useCallback(() => {
    setCurrentStep((s) => Math.min(s + 1, BUILD_STEPS.length - 1));
  }, []);

  const prevStep = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  const heroImageUrl = useMemo(() => {
    const entry = getBuildMediaEntry(heroMediaId, state.modelId);
    return entry.images?.desktop ?? entry.image;
  }, [heroMediaId, state.modelId]);

  const heroImageUrlMobile = useMemo(
    () => getBuildHeroImageUrl(state.modelId, true),
    [state.modelId]
  );

  return {
    state,
    model,
    currentStep,
    pricing,
    barPrice,
    dimensions: getDisplayDimensions(state),
    area: getDisplayArea(state),
    capacity: model.capacity,
    heroImageUrl,
    heroImageUrlMobile,
    selectModel,
    setCustomDimensions,
    selectRadio,
    toggleOption,
    setHeroFromOption,
    goToStep,
    nextStep,
    prevStep,
  };
}
