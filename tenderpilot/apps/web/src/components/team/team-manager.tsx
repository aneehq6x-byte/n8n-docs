"use client";

import { useMutation } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { CheckCircle2, Loader2, LogOut, MailPlus, Trash2, UserMinus } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { roleSchema, type Role } from "@tenderpilot/core/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, Input, Label, NativeSelect } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { useRouter } from "@/i18n/navigation";
import { useTRPC } from "@/trpc/client";

export interface TeamOverview {
  members: { userId: string; name: string; email: string; role: Role; joinedAt: Date }[];
  invitations: { id: string; email: string; role: Role; expiresAt: Date }[];
  seats: { used: number; limit: number };
  me: { userId: string; role: Role };
  canManage: boolean;
  assignableRoles: Role[];
}

const TEAM_ERROR_KEYS = ["FORBIDDEN_ROLE", "ALREADY_MEMBER", "SEAT_LIMIT", "NOT_FOUND", "OWNER_PROTECTED", "SUBSCRIPTION_INACTIVE"] as const;
type TeamErrorKey = (typeof TEAM_ERROR_KEYS)[number] | "generic";

function errorKey(err: unknown): TeamErrorKey {
  const message = err instanceof TRPCClientError ? err.message : "";
  return TEAM_ERROR_KEYS.find((k) => k === message) ?? "generic";
}

export function TeamManager({ overview }: { overview: TeamOverview }) {
  const t = useTranslations("team");
  const tRoles = useTranslations("enums.role");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const trpc = useTRPC();
  const [inviteRole, setInviteRole] = useState<Role>(overview.assignableRoles.at(-2) ?? overview.assignableRoles[0] ?? "viewer");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invited, setInvited] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<TeamErrorKey | null>(null);
  const onDone = () => {
    setActionError(null);
    router.refresh();
  };
  const onError = (err: unknown) => setActionError(errorKey(err));

  const invite = useMutation(
    trpc.team.invite.mutationOptions({
      onSuccess: (res) => {
        setInvited(res.email);
        setInviteEmail("");
        onDone();
      },
    }),
  );
  const changeRole = useMutation(trpc.team.changeRole.mutationOptions({ onSuccess: onDone, onError }));
  const remove = useMutation(trpc.team.remove.mutationOptions({ onSuccess: onDone, onError }));
  const revoke = useMutation(trpc.team.revokeInvitation.mutationOptions({ onSuccess: onDone, onError }));
  const seatsFull = overview.seats.used >= overview.seats.limit;

  function submitInvite(e: FormEvent) {
    e.preventDefault();
    setInvited(null);
    invite.mutate({ email: inviteEmail, role: inviteRole, locale: locale === "en" ? "en" : "ar" });
  }

  const inviteError = invite.error
    ? invite.error.data?.code === "BAD_REQUEST"
      ? t("errors.invalidEmail")
      : t(`errors.${errorKey(invite.error)}`)
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      {overview.canManage && (
        <Card>
          <CardHeader>
            <CardTitle>{t("inviteTitle")}</CardTitle>
            <CardDescription>{t("inviteHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitInvite} className="flex flex-col gap-3 md:flex-row md:items-end" noValidate>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="invite-email" className="text-xs text-muted-foreground">
                  {t("email")}
                </Label>
                <Input id="invite-email" type="email" dir="ltr" className="text-start" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5 md:w-56">
                <Label htmlFor="invite-role" className="text-xs text-muted-foreground">
                  {t("role")}
                </Label>
                <NativeSelect id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(roleSchema.parse(e.target.value))}>
                  {overview.assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {tRoles(r)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button type="submit" disabled={invite.isPending || seatsFull || !inviteEmail}>
                {invite.isPending ? <Loader2 className="animate-spin" /> : <MailPlus />}
                {t("sendInvite")}
              </Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">{t(`roleHint.${inviteRole}`)}</p>
            <FieldError message={inviteError ?? (seatsFull ? t("errors.SEAT_LIMIT") : undefined)} />
            {invited && (
              <p role="status" className="mt-2 flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="size-4" />
                {t("invited", { email: invited })}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>{t("membersTitle")}</CardTitle>
            <CardDescription>{t("seats", { used: overview.seats.used, limit: overview.seats.limit })}</CardDescription>
          </div>
          <div className="h-2 w-28 overflow-hidden rounded-full bg-primary/15" title={t("seats", { used: overview.seats.used, limit: overview.seats.limit })}>
            <div className={seatsFull ? "h-full rounded-full bg-warning" : "h-full rounded-full bg-primary"} style={{ width: `${Math.min(100, (overview.seats.used / Math.max(1, overview.seats.limit)) * 100)}%` }} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FieldError message={actionError ? t(`errors.${actionError}`) : undefined} />
          <ul className="flex flex-col divide-y">
            {overview.members.map((m) => {
              const isMe = m.userId === overview.me.userId;
              const manageable = overview.canManage && !isMe && overview.assignableRoles.includes(m.role);
              return (
                <li key={m.userId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2 font-medium">
                      {m.name}
                      {isMe && <Badge variant="secondary">{t("you")}</Badge>}
                    </span>
                    <span className="ltr-nums truncate text-xs text-muted-foreground">{m.email}</span>
                    <span className="text-xs text-muted-foreground">{t("joined", { date: format.dateTime(m.joinedAt, "short") })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {manageable ? (
                      <NativeSelect
                        aria-label={`${t("role")}: ${m.name}`}
                        value={m.role}
                        disabled={changeRole.isPending}
                        onChange={(e) => changeRole.mutate({ userId: m.userId, role: roleSchema.parse(e.target.value) })}
                        className="w-44"
                      >
                        {overview.assignableRoles.map((r) => (
                          <option key={r} value={r}>
                            {tRoles(r)}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Badge variant={m.role === "owner" ? "default" : "outline"}>{tRoles(m.role)}</Badge>
                    )}
                    {manageable &&
                      (confirming === m.userId ? (
                        <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate({ userId: m.userId })}>
                          {remove.isPending ? <Loader2 className="animate-spin" /> : <UserMinus />}
                          {t("confirmRemove")}
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(m.userId)}>
                          <UserMinus />
                          {t("remove")}
                        </Button>
                      ))}
                    {isMe && m.role !== "owner" && (
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate({ userId: m.userId })}>
                        <LogOut className="rtl:-scale-x-100" />
                        {t("leave")}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {overview.canManage && (
        <Card>
          <CardHeader>
            <CardTitle>{t("pendingTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("pendingEmpty")}</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {overview.invitations.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="ltr-nums min-w-0 flex-1 truncate text-sm">{inv.email}</span>
                    <Badge variant="outline">{tRoles(inv.role)}</Badge>
                    <span className="text-xs text-muted-foreground">{t("expires", { date: format.dateTime(inv.expiresAt, "short") })}</span>
                    {overview.assignableRoles.includes(inv.role) && (
                      <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate({ id: inv.id })}>
                        <Trash2 />
                        {t("revoke")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
