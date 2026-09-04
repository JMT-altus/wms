import {
  NotificationCTA,
  NotificationEmailLayout,
  NotificationHeadline,
  NotificationParagraph,
  Quote,
  taskUrl,
} from "./_notification-layout";

const MESSAGE_CLIP = 280;

export interface NudgeProps {
  recipientName: string;
  actorName: string;
  taskSubject: string;
  taskId: string;
  /** The chaser's optional message. */
  message?: string;
  /** The EFFECTIVE due date (revised when there is one), already formatted. */
  dueLabel?: string;
  siteUrl: string;
}

export const previewText = (p: Pick<NudgeProps, "actorName" | "taskSubject">) =>
  `${p.actorName} nudged you about "${p.taskSubject}"`;

export function NudgeEmail(props: NudgeProps) {
  const raw = (props.message ?? "").trim();
  const clipped =
    raw.length > MESSAGE_CLIP ? `${raw.slice(0, MESSAGE_CLIP)}…` : raw;

  return (
    <NotificationEmailLayout
      preview={previewText({
        actorName: props.actorName,
        taskSubject: props.taskSubject,
      })}
      siteUrl={props.siteUrl}
    >
      <NotificationParagraph muted>Hi {props.recipientName},</NotificationParagraph>
      <NotificationHeadline>
        {props.actorName} nudged you about "{props.taskSubject}".
      </NotificationHeadline>
      {clipped ? <Quote>{clipped}</Quote> : null}
      {props.dueLabel ? (
        <NotificationParagraph muted>Due {props.dueLabel}.</NotificationParagraph>
      ) : null}
      <NotificationCTA href={taskUrl(props.siteUrl, props.taskId)}>
        Open task
      </NotificationCTA>
    </NotificationEmailLayout>
  );
}

export default NudgeEmail;
