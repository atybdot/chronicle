import * as p from "@clack/prompts";
import { Result } from "better-result";
import { PROVIDER_CONFIG, type ProviderKey, fetchModels, filterModels, type ModelInfo } from "../lib/models";

export async function selectModelWithSearch(
  provider: ProviderKey,
  apiKey?: string,
  baseUrl?: string,
): Promise<string | null> {
  const providerConfig = PROVIDER_CONFIG[provider];
  const spinner = p.spinner();

  spinner.start("Fetching available models...");
  const modelsResult = await fetchModels(provider, apiKey, baseUrl);

  let models: ModelInfo[];
  if (Result.isOk(modelsResult)) {
    models = modelsResult.value;
    spinner.stop("Found " + models.length + " models");
  } else {
    spinner.stop("Using recommended models");
    models = providerConfig.recommendedModels.map((id) => ({
      id,
      name: id,
      isRecommended: true,
    }));
  }

  if (models.length === 0) {
    const customModel = await p.text({
      message: "Enter the model name:",
      placeholder: providerConfig.defaultModel,
    });
    if (p.isCancel(customModel)) return null;
    return customModel as string;
  }

  const recommendedModels = models.filter((m) => m.isRecommended);

  const selectionMode = await p.select({
    message: "How would you like to select a model?",
    options: [
      { value: "recommended", label: "Choose from recommended models", hint: recommendedModels.length + " models" },
      { value: "search", label: "Search all available models", hint: models.length + " models" },
      { value: "custom", label: "Enter model name manually" },
    ],
  });

  if (p.isCancel(selectionMode)) return null;

  if (selectionMode === "custom") {
    const customModel = await p.text({
      message: "Enter the model name:",
      placeholder: providerConfig.defaultModel,
    });
    if (p.isCancel(customModel)) return null;
    return customModel as string;
  }

  if (selectionMode === "recommended") {
    const options = recommendedModels.map((m, index) => ({
      value: m.id,
      label: m.id,
      hint: index === 0 ? "default" : undefined,
    }));

    const choice = await p.select({
      message: "Select a model:",
      options,
    });

    if (p.isCancel(choice)) return null;
    return choice as string;
  }

  let selectedModel: string | null = null;
  let searchQuery = "";

  while (selectedModel === null) {
    const filteredModels = filterModels(models, searchQuery);
    const displayModels = filteredModels.slice(0, 15);
    const hasMore = filteredModels.length > 15;

    const options: Array<{ value: string; label: string; hint?: string }> = [];

    options.push({
      value: "__search__",
      label: searchQuery ? 'Change search ("' + searchQuery + '")' : "Type to search...",
      hint: filteredModels.length + " models found",
    });

    for (const m of displayModels) {
      options.push({
        value: m.id,
        label: m.id,
        hint: m.contextLength ? Math.round(m.contextLength / 1000) + "k ctx" : undefined,
      });
    }

    if (hasMore) {
      options.push({ value: "__search__", label: "... and " + (filteredModels.length - 15) + " more" });
    }

    options.push({ value: "__custom__", label: "Enter model name manually" });

    const choice = await p.select({
      message: searchQuery ? 'Select a model ("' + searchQuery + '"):' : "Select a model:",
      options,
    });

    if (p.isCancel(choice)) return null;

    if (choice === "__search__") {
      const newQuery = await p.text({
        message: "Search models:",
        placeholder: "e.g., gpt-4, claude, llama",
        initialValue: searchQuery,
      });

      if (p.isCancel(newQuery)) {
        searchQuery = "";
        continue;
      }

      searchQuery = (newQuery as string).trim();
      continue;
    }

    if (choice === "__custom__") {
      const customModel = await p.text({
        message: "Enter the model name:",
        placeholder: providerConfig.defaultModel,
      });
      if (p.isCancel(customModel)) continue;
      selectedModel = customModel as string;
    } else {
      selectedModel = choice as string;
    }
  }

  return selectedModel;
}
