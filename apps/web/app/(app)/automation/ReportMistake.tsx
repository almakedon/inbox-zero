"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  CheckIcon,
  ExternalLinkIcon,
  HammerIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import useSWR from "swr";
import { type SubmitHandler, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/Input";
import { toastError, toastSuccess } from "@/components/Toast";
import { isActionError } from "@/utils/error";
import type { RunRulesResult } from "@/utils/ai/choose-rule/run-rules";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { reportAiMistakeAction, runRulesAction } from "@/utils/actions/ai-rule";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  reportAiMistakeBody,
  updateRuleInstructionsBody,
  type UpdateRuleInstructionsBody,
  type ReportAiMistakeBody,
} from "@/utils/actions/validation";
import type { RulesResponse } from "@/app/api/user/rules/route";
import { LoadingContent } from "@/components/LoadingContent";
import { Input } from "@/components/Input";
import { GroupItemType, type Rule } from "@prisma/client";
import { updateRuleInstructionsAction } from "@/utils/actions/rule";
import { Separator } from "@/components/ui/separator";
import { SectionDescription } from "@/components/Typography";
import { Badge } from "@/components/Badge";
import { ProcessResultDisplay } from "@/app/(app)/automation/ProcessResultDisplay";
import { isReplyInThread } from "@/utils/thread";
import { isAIRule, isGroupRule, isStaticRule } from "@/utils/condition";
import { Loading } from "@/components/Loading";
import type { ParsedMessage } from "@/utils/types";
import {
  addGroupItemAction,
  deleteGroupItemAction,
} from "@/utils/actions/group";
import { toast } from "sonner";

type ReportMistakeView = "select-expected-rule" | "ai-fix" | "manual-fix";

const NONE_RULE_ID = "__NONE__";

export function ReportMistake({
  message,
  result,
  isTest,
}: {
  message: ParsedMessage;
  result: RunRulesResult | null;
  isTest: boolean;
}) {
  const { data, isLoading, error } = useSWR<RulesResponse, { error: string }>(
    "/api/user/rules",
  );
  const actualRule = result?.rule;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <HammerIcon className="mr-2 size-4" />
          Fix
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Improve Rules</DialogTitle>
        </DialogHeader>

        <LoadingContent loading={isLoading} error={error}>
          {data && (
            <Content
              rules={data}
              message={message}
              result={result}
              actualRule={actualRule ?? null}
              isTest={isTest}
            />
          )}
        </LoadingContent>
      </DialogContent>
    </Dialog>
  );
}

function Content({
  rules,
  message,
  result,
  actualRule,
  isTest,
}: {
  rules: RulesResponse;
  message: ParsedMessage;
  result: RunRulesResult | null;
  actualRule: Rule | null;
  isTest: boolean;
}) {
  const [loadingAiFix, setLoadingAiFix] = useState(false);
  const [fixedInstructions, setFixedInstructions] = useState<{
    ruleId: string;
    fixedInstructions: string;
  }>();
  const fixedInstructionsRule = useMemo(
    () => rules.find((rule) => rule.id === fixedInstructions?.ruleId),
    [rules, fixedInstructions],
  );

  const [expectedRuleId, setExpectedRuleId] = useState<string | null>(null);
  const expectedRule = useMemo(
    () => rules.find((rule) => rule.id === expectedRuleId),
    [rules, expectedRuleId],
  );

  const [viewStack, setViewStack] = useState<ReportMistakeView[]>([
    "select-expected-rule",
  ]);
  const view = useMemo(() => viewStack[viewStack.length - 1], [viewStack]);

  const onSetView = useCallback((newView: ReportMistakeView) => {
    setViewStack((stack) => [...stack, newView]);
  }, []);

  const onBack = useCallback(() => {
    setViewStack((stack) => {
      if (stack.length <= 1) return stack;
      const newStack = stack.slice(0, -1);
      return newStack;
    });
  }, []);

  const onSelectExpectedRule = useCallback(
    async (expectedRuleId: string | null) => {
      setExpectedRuleId(expectedRuleId);

      const expectedRule = rules.find((rule) => rule.id === expectedRuleId);

      // if AI rule, then use AI to suggest a fix
      const isEitherAIRule =
        (expectedRule && isAIRule(expectedRule)) ||
        (actualRule && isAIRule(actualRule));

      if (isEitherAIRule) {
        onSetView("ai-fix");
        setLoadingAiFix(true);
        const response = await reportAiMistakeAction({
          actualRuleId: result?.rule?.id,
          expectedRuleId: expectedRule?.id,
          email: {
            from: message.headers.from,
            subject: message.headers.subject,
            snippet: message.snippet,
            textHtml: message.textHtml || null,
            textPlain: message.textPlain || null,
          },
        });

        setLoadingAiFix(false);
        if (isActionError(response)) {
          toastError({
            title: "Error reporting mistake",
            description: response.error,
          });
        } else {
          if (response.ruleId) {
            setFixedInstructions({
              ruleId: response.ruleId,
              fixedInstructions: response.fixedInstructions,
            });
          } else {
            toastError({
              title: "Error reporting mistake",
              description:
                "No rule ID returned. Please contact support if this persists.",
            });
          }
        }
      } else {
        // if not AI rule, then show the manual fix view
        onSetView("manual-fix");
      }
    },
    [message, result?.rule?.id, onSetView, actualRule, rules],
  );

  if (view === "select-expected-rule") {
    return (
      <RuleMismatch
        result={result}
        onSelectExpectedRuleId={onSelectExpectedRule}
        rules={rules}
      />
    );
  }

  const isExpectedGroupRule = !!(expectedRule && isGroupRule(expectedRule));
  const isActualGroupRule = !!(actualRule && isGroupRule(actualRule));

  if (isExpectedGroupRule || isActualGroupRule) {
    return (
      <GroupMismatch
        ruleId={expectedRule?.id || actualRule?.id!}
        groupId={expectedRule?.groupId || actualRule?.groupId!}
        message={message}
        isExpectedGroupRule={isExpectedGroupRule}
        onBack={onBack}
      />
    );
  }

  const isExpectedStaticRule = !!(expectedRule && isStaticRule(expectedRule));
  const isActualStaticRule = !!(actualRule && isStaticRule(actualRule));

  if (isExpectedStaticRule || isActualStaticRule) {
    return (
      <StaticMismatch
        ruleId={expectedRule?.id || actualRule?.id!}
        isExpectedStaticRule={isExpectedStaticRule}
        onBack={onBack}
      />
    );
  }

  if (
    expectedRule &&
    !expectedRule.runOnThreads &&
    isReplyInThread(message.id, message.threadId)
  ) {
    return (
      <ThreadSettingsMismatchMessage
        expectedRuleId={expectedRule.id}
        onBack={onBack}
      />
    );
  }

  if (view === "ai-fix") {
    return (
      <AIFixView
        loadingAiFix={loadingAiFix}
        fixedInstructions={fixedInstructions ?? null}
        fixedInstructionsRule={fixedInstructionsRule ?? null}
        message={message}
        isTest={isTest}
        onBack={onBack}
        onReject={() => onSetView("manual-fix")}
      />
    );
  }

  if (view === "manual-fix") {
    return (
      <ManualFixView
        actualRule={actualRule}
        expectedRule={expectedRule}
        message={message}
        result={result}
        isTest={isTest}
        onBack={onBack}
      />
    );
  }

  const exhaustiveCheck: never = view;
  return exhaustiveCheck;
}

function AIFixView({
  loadingAiFix,
  fixedInstructions,
  fixedInstructionsRule,
  message,
  isTest,
  onBack,
  onReject,
}: {
  loadingAiFix: boolean;
  fixedInstructions: {
    ruleId: string;
    fixedInstructions: string;
  } | null;
  fixedInstructionsRule: Rule | null;
  message: ParsedMessage;
  isTest: boolean;
  onBack: () => void;
  onReject: () => void;
}) {
  if (loadingAiFix) {
    return (
      <div className="flex flex-col items-center justify-center space-y-1">
        <SectionDescription>Suggesting a fix...</SectionDescription>
        <Loading />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {fixedInstructionsRule?.instructions ? (
        <div className="space-y-2">
          <ProcessResultDisplay result={{ rule: fixedInstructionsRule }} />
          <Instructions
            label="Original:"
            instructions={fixedInstructionsRule?.instructions}
          />
        </div>
      ) : (
        <p className="text-sm">No rule found for the fixed instructions.</p>
      )}

      {fixedInstructions?.ruleId && (
        <SuggestedFix
          message={message}
          ruleId={fixedInstructions.ruleId}
          fixedInstructions={fixedInstructions.fixedInstructions}
          onReject={onReject}
          showRerunButton
          isTest={isTest}
        />
      )}

      <BackButton onBack={onBack} />
    </div>
  );
}

function RuleMismatch({
  result,
  rules,
  onSelectExpectedRuleId,
}: {
  result: RunRulesResult | null;
  rules: RulesResponse;
  onSelectExpectedRuleId: (ruleId: string | null) => void;
}) {
  return (
    <div>
      <Label name="matchedRule" label="Matched:" />
      <div className="mt-1">
        {result ? (
          <ProcessResultDisplay result={result} />
        ) : (
          <p>No rule matched</p>
        )}
      </div>
      <div className="mt-4">
        <Label name="ruleId" label="Which rule did you expect it to match?" />
      </div>

      {!rules.length && (
        <SectionDescription className="mt-2">
          You haven't created any rules yet!
        </SectionDescription>
      )}

      <div className="mt-1 flex flex-col gap-1">
        {[{ id: NONE_RULE_ID, name: "None" }, ...rules]
          .filter((rule) => rule.id !== (result?.rule?.id || NONE_RULE_ID))
          .map((rule) => (
            <Button
              key={rule.id}
              variant="outline"
              onClick={() => onSelectExpectedRuleId(rule.id)}
            >
              {rule.name}
            </Button>
          ))}
      </div>
    </div>
  );
}

function ThreadSettingsMismatchMessage({
  expectedRuleId,
  onBack,
}: {
  expectedRuleId: string;
  onBack: () => void;
}) {
  return (
    <div>
      <SectionDescription>
        This rule didn't match because the message is part of a thread, but this
        rule is set to not run on threads.
      </SectionDescription>
      <div className="mt-2 flex gap-2">
        <BackButton onBack={onBack} />
        <EditRuleButton ruleId={expectedRuleId} />
      </div>
    </div>
  );
}

function GroupMismatch({
  ruleId,
  groupId,
  message,
  isExpectedGroupRule,
  onBack,
}: {
  ruleId: string;
  groupId: string;
  message: ParsedMessage;
  isExpectedGroupRule: boolean;
  onBack: () => void;
}) {
  return (
    <div>
      <SectionDescription>
        {isExpectedGroupRule
          ? // Case 1: User expected this group rule to match, but it didn't
            "The rule you expected it to match is a group rule, but this message didn't match any of the group items. You can edit the group to include this email."
          : // Case 2: User didn't expect this group rule to match, but it did
            "This email matched because it's part of a group rule. To prevent it from matching, you'll need to remove it from the group or adjust the group settings."}
      </SectionDescription>

      {isExpectedGroupRule && (
        <div className="mt-2 flex gap-2">
          <div className="rounded border border-gray-200 bg-gray-50 p-2 text-sm">
            From: {message.headers.from}
          </div>
          <Button
            className="mt-2"
            onClick={() => {
              toast.promise(
                async () => {
                  const result = await addGroupItemAction({
                    groupId,
                    type: GroupItemType.FROM,
                    value: message.headers.from,
                  });

                  if (isActionError(result)) throw new Error(result.error);
                },
                {
                  loading: "Adding to group...",
                  success: "Added to group",
                  error: (error) => `Failed to add to group: ${error.message}`,
                },
              );
            }}
          >
            Add to group
          </Button>
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <BackButton onBack={onBack} />
        <EditRuleButton ruleId={ruleId} />
      </div>
    </div>
  );
}

// TODO: Could auto fix the static rule for the user
function StaticMismatch({
  ruleId,
  isExpectedStaticRule,
  onBack,
}: {
  ruleId: string;
  isExpectedStaticRule: boolean;
  onBack: () => void;
}) {
  return (
    <div>
      <SectionDescription>
        {isExpectedStaticRule
          ? // Case 1: User expected this static rule to match, but it didn't
            " The rule you expected it to match is set to match static conditions, but this message doesn't match any of the static conditions."
          : // Case 2: User didn't expect this static rule to match, but it did
            "This email matched because of static conditions in the rule. To prevent it from matching, you'll need to remove or adjust the matching conditions in the rule settings."}
      </SectionDescription>
      <div className="mt-2 flex gap-2">
        <BackButton onBack={onBack} />
        <EditRuleButton ruleId={ruleId} />
      </div>
    </div>
  );
}

function ManualFixView({
  actualRule,
  expectedRule,
  message,
  result,
  onBack,
  isTest,
}: {
  actualRule?: Rule | null;
  expectedRule?: Rule | null;
  message: ParsedMessage;
  result: RunRulesResult | null;
  onBack: () => void;
  isTest: boolean;
}) {
  return (
    <>
      <>
        {result && <ProcessResultDisplay result={result} prefix="Matched: " />}
        {actualRule && (
          <>
            {isAIRule(actualRule) ? (
              <RuleForm rule={actualRule} />
            ) : (
              <EditRuleButton ruleId={actualRule.id} />
            )}
            <Separator />
          </>
        )}
      </>
      {expectedRule && (
        <>
          <Badge color="green">Expected: {expectedRule.name}</Badge>
          {isAIRule(expectedRule) ? (
            <RuleForm rule={expectedRule} />
          ) : (
            <EditRuleButton ruleId={expectedRule.id} />
          )}
          <Separator />
        </>
      )}

      {expectedRule && isAIRule(expectedRule) && (
        <>
          <SectionDescription>Or fix with AI:</SectionDescription>
          <AIFixForm
            message={message}
            result={result}
            expectedRuleId={expectedRule.id}
            isTest={isTest}
          />
          <Separator />
        </>
      )}
      <RerunButton message={message} isTest={isTest} />
      <BackButton onBack={onBack} />
    </>
  );
}

function RuleForm({
  rule,
}: {
  rule: Pick<Rule, "id" | "instructions"> & { instructions: string };
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateRuleInstructionsBody>({
    resolver: zodResolver(updateRuleInstructionsBody),
    defaultValues: {
      id: rule.id,
      instructions: rule.instructions,
    },
  });

  const updateRule: SubmitHandler<UpdateRuleInstructionsBody> = useCallback(
    async (data) => {
      const response = await updateRuleInstructionsAction(data);

      if (isActionError(response)) {
        toastError({
          title: "Error updating rule",
          description: response.error,
        });
      } else {
        toastSuccess({ description: "Rule updated!" });
      }
    },
    [],
  );

  return (
    <form onSubmit={handleSubmit(updateRule)} className="space-y-4">
      <Input
        type="text"
        autosizeTextarea
        rows={2}
        name="instructions"
        label="Adjust the instructions"
        placeholder="Updated instructions"
        registerProps={register("instructions")}
        error={errors.instructions}
      />
      <Button type="submit" loading={isSubmitting}>
        Save
      </Button>
    </form>
  );
}

function AIFixForm({
  message,
  result,
  expectedRuleId,
  isTest,
}: {
  message: ParsedMessage;
  result: RunRulesResult | null;
  expectedRuleId: string | null;
  isTest: boolean;
}) {
  const [fixedInstructions, setFixedInstructions] = useState<{
    ruleId: string;
    fixedInstructions: string;
  }>();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ReportAiMistakeBody>({
    resolver: zodResolver(reportAiMistakeBody),
    defaultValues: {
      actualRuleId: result?.rule?.id,
      expectedRuleId:
        expectedRuleId === NONE_RULE_ID ? undefined : expectedRuleId,
      email: {
        from: message.headers.from,
        subject: message.headers.subject,
        snippet: message.snippet,
        textHtml: message.textHtml || null,
        textPlain: message.textPlain || null,
      },
    },
  });

  if (Object.keys(errors).length > 0) {
    console.error("Errors:", errors);
  }

  const reportMistake: SubmitHandler<ReportAiMistakeBody> = useCallback(
    async (data) => {
      const response = await reportAiMistakeAction(data);

      if (isActionError(response)) {
        toastError({
          title: "Error reporting mistake",
          description: response.error,
        });
      } else {
        toastSuccess({
          description: `This is the updated rule: ${response.fixedInstructions}`,
        });

        if (response.ruleId) {
          setFixedInstructions({
            ruleId: response.ruleId,
            fixedInstructions: response.fixedInstructions,
          });
        } else {
          toastError({
            title: "Error reporting mistake",
            description:
              "No rule ID returned. Please contact support if this persists.",
          });
        }
      }
    },
    [],
  );

  return (
    <div>
      <form onSubmit={handleSubmit(reportMistake)} className="space-y-2">
        <Input
          type="text"
          autosizeTextarea
          rows={2}
          name="explanation"
          label="Explanation"
          placeholder="Optional: What was incorrect about this response?"
          registerProps={register("explanation")}
          error={errors.explanation}
        />
        <Button type="submit" loading={isSubmitting}>
          Fix with AI
        </Button>
      </form>

      {fixedInstructions && (
        <SuggestedFix
          message={message}
          ruleId={fixedInstructions.ruleId}
          fixedInstructions={fixedInstructions.fixedInstructions}
          onReject={() => setFixedInstructions(undefined)}
          showRerunButton={false}
          isTest={isTest}
        />
      )}
    </div>
  );
}

function SuggestedFix({
  message,
  ruleId,
  fixedInstructions,
  onReject,
  showRerunButton,
  isTest,
}: {
  message: ParsedMessage;
  ruleId: string;
  fixedInstructions: string;
  onReject: () => void;
  showRerunButton: boolean;
  isTest: boolean;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [accepted, setAccepted] = useState(false);

  return (
    <div className="mt-4">
      <Instructions label="Suggested fix:" instructions={fixedInstructions} />

      {accepted ? (
        showRerunButton && (
          <div className="mt-2">
            <RerunButton message={message} isTest={isTest} />
          </div>
        )
      ) : (
        <div className="mt-2 flex gap-2">
          <Button
            loading={isSaving}
            onClick={async () => {
              setIsSaving(true);
              const res = await updateRuleInstructionsAction({
                id: ruleId,
                instructions: fixedInstructions,
              });

              if (isActionError(res)) {
                toastError({ description: res.error });
              } else {
                toastSuccess({ description: "Rule updated!" });
              }
              setIsSaving(false);
              setAccepted(true);
            }}
          >
            <CheckIcon className="mr-2 size-4" />
            Accept
          </Button>
          <Button variant="outline" loading={isSaving} onClick={onReject}>
            <XIcon className="mr-2 size-4" />
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

function Instructions({
  label,
  instructions,
}: {
  label: string;
  instructions: string;
}) {
  return (
    <div>
      <p className="text-sm">{label}</p>
      <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2 text-sm">
        {instructions}
      </div>
    </div>
  );
}

function RerunButton({
  message,
  isTest,
}: {
  message: ParsedMessage;
  isTest: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<RunRulesResult>();

  return (
    <>
      <Button
        loading={checking}
        onClick={async () => {
          setChecking(true);

          const result = await runRulesAction({
            messageId: message.id,
            threadId: message.threadId,
            isTest,
          });
          if (isActionError(result)) {
            toastError({
              title: "There was an error testing the email",
              description: result.error,
            });
          } else {
            setResult(result);
          }
          setChecking(false);
        }}
      >
        <SparklesIcon className="mr-2 size-4" />
        Rerun
      </Button>

      {result && (
        <div className="mt-2 flex items-center gap-2">
          <SectionDescription>Result:</SectionDescription>
          <ProcessResultDisplay result={result} />
        </div>
      )}
    </>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onBack}>
      <ArrowLeftIcon className="mr-2 size-4" />
      Back
    </Button>
  );
}

function EditRuleButton({ ruleId }: { ruleId: string }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={`/automation/rule/${ruleId}`} target="_blank">
        <ExternalLinkIcon className="mr-2 size-4" />
        Edit Rule
      </Link>
    </Button>
  );
}
