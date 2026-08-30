<template>
  <div class="grid md:grid-cols-3 gap-8 md:gap-4 pt-8">
    <div class="md:col-span-1">
      <h3 class="heading">{{ t('configs.ai.title') }}</h3>
      <p class="my-1 text-secondaryLight">
        {{ t('configs.ai.description') }}
      </p>
    </div>

    <div class="sm:px-8 md:col-span-2 space-y-8">
      <!-- Enable -->
      <section>
        <HoppSmartToggle
          :on="fields.ai_enabled === 'true'"
          @change="toggle('ai_enabled')"
        >
          {{ t('configs.ai.enable') }}
        </HoppSmartToggle>
        <p class="text-secondaryLight mt-2 text-tiny">
          {{ t('configs.ai.enable_description') }}
        </p>
      </section>

      <template v-if="fields.ai_enabled === 'true'">
        <!-- Provider -->
        <section>
          <h4 class="font-semibold text-secondaryDark mb-2">
            {{ t('configs.ai.provider') }}
          </h4>
          <div class="flex flex-col gap-2">
            <label
              v-for="option in providerOptions"
              :key="option.value"
              class="flex items-center gap-2 cursor-pointer"
            >
              <input
                v-model="fields.ai_provider"
                type="radio"
                :value="option.value"
                class="accent-accent"
              />
              <span class="text-secondaryDark">{{ option.label }}</span>
            </label>
          </div>
        </section>

        <!-- Azure AI Foundry (Claude) -->
        <section v-if="fields.ai_provider === 'AZURE_FOUNDRY_ANTHROPIC'">
          <h4 class="font-semibold text-secondaryDark">
            {{ t('configs.ai.foundry_title') }}
          </h4>

          <div class="space-y-4 py-4">
            <div>
              <label class="block text-sm font-medium text-secondaryDark mb-2">
                {{ t('configs.ai.foundry_resource') }}
              </label>
              <HoppSmartInput
                v-model="fields.ai_azure_foundry_resource"
                type="text"
                placeholder="my-resource.azure.anthropic.com"
                class="!bg-primaryLight border border-divider rounded"
                :input-styles="
                  resourceInvalid ? '!border-red-500' : '!border-0'
                "
              />
              <p
                class="mt-1 text-tiny"
                :class="resourceInvalid ? 'text-red-500' : 'text-secondaryLight'"
              >
                {{ t('configs.ai.foundry_resource_description') }}
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-secondaryDark mb-2">
                {{ t('configs.ai.api_key') }}
              </label>
              <HoppSmartInput
                v-model="fields.ai_azure_foundry_api_key"
                type="password"
                autocomplete="off"
                class="!bg-primaryLight border border-divider rounded"
                input-styles="!border-0"
              />
              <p class="text-secondaryLight mt-1 text-tiny">
                {{ t('configs.ai.api_key_description') }}
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-secondaryDark mb-2">
                {{ t('configs.ai.model') }}
              </label>
              <HoppSmartInput
                v-model="fields.ai_azure_foundry_model"
                type="text"
                placeholder="claude-opus-5"
                class="!bg-primaryLight border border-divider rounded"
                input-styles="!border-0"
              />
            </div>
          </div>
        </section>

        <!-- Azure OpenAI -->
        <section v-else>
          <h4 class="font-semibold text-secondaryDark">
            {{ t('configs.ai.openai_title') }}
          </h4>

          <div class="space-y-4 py-4">
            <div>
              <label class="block text-sm font-medium text-secondaryDark mb-2">
                {{ t('configs.ai.openai_endpoint') }}
              </label>
              <HoppSmartInput
                v-model="fields.ai_azure_openai_endpoint"
                type="text"
                placeholder="https://my-resource.openai.azure.com"
                class="!bg-primaryLight border border-divider rounded"
                input-styles="!border-0"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-secondaryDark mb-2">
                {{ t('configs.ai.api_key') }}
              </label>
              <HoppSmartInput
                v-model="fields.ai_azure_openai_api_key"
                type="password"
                autocomplete="off"
                class="!bg-primaryLight border border-divider rounded"
                input-styles="!border-0"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-secondaryDark mb-2">
                {{ t('configs.ai.openai_deployment') }}
              </label>
              <HoppSmartInput
                v-model="fields.ai_azure_openai_deployment"
                type="text"
                class="!bg-primaryLight border border-divider rounded"
                input-styles="!border-0"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-secondaryDark mb-2">
                {{ t('configs.ai.openai_api_version') }}
              </label>
              <HoppSmartInput
                v-model="fields.ai_azure_openai_api_version"
                type="text"
                class="!bg-primaryLight border border-divider rounded"
                input-styles="!border-0"
              />
            </div>
          </div>
        </section>

        <!-- Advanced -->
        <section>
          <h4 class="font-semibold text-secondaryDark">
            {{ t('configs.ai.advanced_title') }}
          </h4>
          <div class="space-y-4 py-4">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-secondaryDark mb-2">
                  {{ t('configs.ai.max_output_tokens') }}
                </label>
                <HoppSmartInput
                  v-model="fields.ai_max_output_tokens"
                  type="number"
                  class="!bg-primaryLight border border-divider rounded"
                  input-styles="!border-0"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-secondaryDark mb-2">
                  {{ t('configs.ai.max_tool_iterations') }}
                </label>
                <HoppSmartInput
                  v-model="fields.ai_max_tool_iterations"
                  type="number"
                  class="!bg-primaryLight border border-divider rounded"
                  input-styles="!border-0"
                />
              </div>
            </div>

            <HoppSmartToggle
              :on="fields.ai_enable_thinking === 'true'"
              @change="toggle('ai_enable_thinking')"
            >
              {{ t('configs.ai.enable_thinking') }}
            </HoppSmartToggle>
            <p class="text-secondaryLight text-tiny">
              {{ t('configs.ai.enable_thinking_description') }}
            </p>
          </div>
        </section>

        <!-- MCP -->
        <section>
          <h4 class="font-semibold text-secondaryDark">
            {{ t('configs.ai.mcp_title') }}
          </h4>
          <div class="space-y-3 py-4">
            <HoppSmartToggle
              :on="fields.ai_mcp_enabled === 'true'"
              @change="toggle('ai_mcp_enabled')"
            >
              {{ t('configs.ai.mcp_enable') }}
            </HoppSmartToggle>
            <p class="text-secondaryLight text-tiny">
              {{ t('configs.ai.mcp_description') }}
            </p>

            <div
              v-if="fields.ai_mcp_enabled === 'true'"
              class="p-3 bg-primaryLight border border-divider rounded"
            >
              <p class="text-secondaryDark text-tiny mb-2">
                {{ t('configs.ai.mcp_connect_hint') }}
              </p>
              <div class="flex items-start gap-2">
                <code
                  class="font-mono text-tiny text-secondaryDark whitespace-pre-wrap flex-1 break-all"
                  >{{ mcpCommand }}</code
                >
                <HoppButtonSecondary
                  :icon="IconCopy"
                  outline
                  filled
                  @click="copyMcpCommand"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- Request execution -->
        <section>
          <h4 class="font-semibold text-secondaryDark">
            {{ t('configs.ai.execution_title') }}
          </h4>
          <div class="space-y-4 py-4">
            <HoppSmartToggle
              :on="fields.agent_request_execution_enabled === 'true'"
              @change="toggle('agent_request_execution_enabled')"
            >
              {{ t('configs.ai.execution_enable') }}
            </HoppSmartToggle>
            <div
              class="flex items-start p-3 bg-primaryLight border border-divider rounded gap-3"
            >
              <icon-lucide-shield-alert
                class="svg-icons text-yellow-500 flex-shrink-0 mt-0.5"
              />
              <p class="text-secondaryDark text-tiny">
                {{ t('configs.ai.execution_warning') }}
              </p>
            </div>

            <template v-if="fields.agent_request_execution_enabled === 'true'">
              <div>
                <label class="block text-sm font-medium text-secondaryDark mb-2">
                  {{ t('configs.ai.allowed_hosts') }}
                </label>
                <HoppSmartInput
                  v-model="fields.agent_request_allowed_hosts"
                  type="text"
                  placeholder="api.example.com, *.internal.dev"
                  class="!bg-primaryLight border border-divider rounded"
                  input-styles="!border-0"
                />
                <p class="text-secondaryLight mt-1 text-tiny">
                  {{ t('configs.ai.allowed_hosts_description') }}
                </p>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label
                    class="block text-sm font-medium text-secondaryDark mb-2"
                  >
                    {{ t('configs.ai.timeout_ms') }}
                  </label>
                  <HoppSmartInput
                    v-model="fields.agent_request_timeout_ms"
                    type="number"
                    class="!bg-primaryLight border border-divider rounded"
                    input-styles="!border-0"
                  />
                </div>
                <div>
                  <label
                    class="block text-sm font-medium text-secondaryDark mb-2"
                  >
                    {{ t('configs.ai.max_response_bytes') }}
                  </label>
                  <HoppSmartInput
                    v-model="fields.agent_request_max_response_bytes"
                    type="number"
                    class="!bg-primaryLight border border-divider rounded"
                    input-styles="!border-0"
                  />
                </div>
              </div>
            </template>
          </div>
        </section>
      </template>

      <!-- AI settings save without restarting, so they get their own button. -->
      <div class="flex items-center gap-4 pt-2 border-t border-divider">
        <HoppButtonPrimary
          :label="t('configs.ai.save')"
          :loading="saving"
          :disabled="resourceInvalid"
          @click="save"
        />
        <span class="text-secondaryLight text-tiny">
          {{ t('configs.ai.save_hint') }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useVModel } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useMutation } from '@urql/vue';
import IconCopy from '~icons/lucide/copy';
import { useI18n } from '~/composables/i18n';
import { useToast } from '~/composables/toast';
import { useConfigHandler } from '~/composables/useConfigHandler';
import { ServerConfigs, isValidFoundryResource } from '~/helpers/configs';
import { UpdateAiConfigsDocument } from '~/helpers/backend/graphql';

const t = useI18n();
const toast = useToast();

const props = defineProps<{ config: ServerConfigs }>();
const emit = defineEmits<{
  (e: 'update:config', v: ServerConfigs): void;
}>();

const workingConfigs = useVModel(props, 'config', emit);

const EMPTY_FIELDS = {
  ai_enabled: 'false',
  ai_provider: 'AZURE_FOUNDRY_ANTHROPIC',
  ai_azure_foundry_resource: '',
  ai_azure_foundry_api_key: '',
  ai_azure_foundry_model: 'claude-opus-5',
  ai_azure_openai_endpoint: '',
  ai_azure_openai_api_key: '',
  ai_azure_openai_deployment: '',
  ai_azure_openai_api_version: '2025-04-01-preview',
  ai_max_output_tokens: '8192',
  ai_max_tool_iterations: '20',
  ai_enable_thinking: 'false',
  ai_mcp_enabled: 'false',
  agent_request_execution_enabled: 'false',
  agent_request_allowed_hosts: '',
  agent_request_timeout_ms: '30000',
  agent_request_max_response_bytes: '5242880',
};

const fields = computed({
  get() {
    return workingConfigs.value.aiConfigs?.fields ?? { ...EMPTY_FIELDS };
  },
  set(v) {
    if (!workingConfigs.value.aiConfigs) {
      workingConfigs.value.aiConfigs = { name: 'ai', fields: v };
    } else workingConfigs.value.aiConfigs.fields = v as any;
  },
});

const providerOptions = [
  {
    value: 'AZURE_FOUNDRY_ANTHROPIC',
    label: t('configs.ai.provider_foundry'),
  },
  { value: 'AZURE_OPENAI', label: t('configs.ai.provider_openai') },
];

const toggle = (key: keyof typeof EMPTY_FIELDS) => {
  fields.value = {
    ...fields.value,
    [key]: fields.value[key] === 'true' ? 'false' : 'true',
  };
};

const resourceInvalid = computed(
  () =>
    fields.value.ai_provider === 'AZURE_FOUNDRY_ANTHROPIC' &&
    !isValidFoundryResource(fields.value.ai_azure_foundry_resource)
);

const mcpCommand = computed(() => {
  const base = (import.meta.env.VITE_BACKEND_API_URL ?? '').replace(
    /\/v1\/?$/,
    ''
  );
  return `claude mcp add --transport http hoppscotch ${base}/mcp --header "Authorization: Bearer <your-hoppscotch-PAT>"`;
});

const copyMcpCommand = async () => {
  await navigator.clipboard.writeText(mcpCommand.value);
  toast.success(t('state.copied_to_clipboard'));
};

const saving = ref(false);
const updateAIConfigsMutation = useMutation(UpdateAiConfigsDocument);
const { updateAIConfigs } = useConfigHandler(workingConfigs.value);

const save = async () => {
  saving.value = true;
  const ok = await updateAIConfigs(updateAIConfigsMutation);
  saving.value = false;
  // No restart countdown here: updateAIConfigs writes without stopping the app.
  if (ok) toast.success(t('configs.ai.save_success'));
};
</script>
