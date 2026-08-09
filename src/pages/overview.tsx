import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock3,
  Gauge,
  MailCheck,
  MousePointerClick,
  Plus,
  Send,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { get } from "@/lib/api";
import { number, percent, relative, shortDate } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Campaign = {
  id: string;
  subject: string;
  label: string;
  status: string;
  total_recipients: number;
  delivered: number;
  sent_at?: string;
  scheduled_at?: string;
  created_at: string;
};
type Overview = {
  campaignStats: { campaigns: number; delivered: number };
  eventStats: Array<{ type: string; count: number }>;
  subscriberStats: Array<{ status: string; count: number }>;
  campaigns: Campaign[];
  provider: {
    provider: string;
    provider_config: {
      dailyRemaining?: number;
      sendRate?: number;
      healthy?: boolean;
    };
    monthly_limit: number;
    current_usage: number;
  };
  alerts: Array<{
    id: string;
    severity: string;
    title: string;
    detail: string;
  }>;
};

export default function OverviewPage() {
  const { brand } = useAuth();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["overview", brand?.id],
    queryFn: () => get<Overview>(`/api/brands/${brand?.id}/overview`),
    enabled: !!brand,
  });
  if (!brand)
    return (
      <div className="rounded-lg border bg-card p-8">
        Create a brand to begin.
      </div>
    );
  if (query.isLoading || !query.data)
    return (
      <>
        <Skeleton className="mb-6 h-20" />
        <Skeleton className="h-[32rem]" />
      </>
    );
  const data = query.data;
  const event = Object.fromEntries(
    data.eventStats.map((item) => [item.type, item.count]),
  );
  const subscribers = Object.fromEntries(
    data.subscriberStats.map((item) => [item.status, item.count]),
  );
  const delivered = Number(data.campaignStats.delivered) || 1;
  return (
    <>
      <PageHeader
        eyebrow={`${brand.name} workspace`}
        title="Delivery overview"
        description="Live campaign, audience, and provider health at a glance."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/audiences")}>
              <UsersRound /> Manage audiences
            </Button>
            <Button onClick={() => navigate("/campaigns/new")}>
              <Plus /> Create campaign
            </Button>
          </>
        }
      />
      <div className="mb-5 grid overflow-hidden rounded-lg border bg-card md:grid-cols-4">
        <div className="flex items-center gap-3 border-b p-4 md:border-b-0 md:border-e">
          <span className="grid size-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
            <Check className="size-5" />
          </span>
          <div>
            <p className="text-sm font-medium">Provider configured</p>
            <p className="text-xs text-muted-foreground">
              {data.provider.provider} delivery transport
            </p>
          </div>
        </div>
        <div className="border-b p-4 md:border-b-0 md:border-e">
          <p className="metric-number text-xl">
            {data.provider.provider_config.dailyRemaining == null
              ? "—"
              : number.format(data.provider.provider_config.dailyRemaining)}
          </p>
          <p className="text-xs text-muted-foreground">remaining today</p>
        </div>
        <div className="border-b p-4 md:border-b-0 md:border-e">
          <p className="metric-number text-xl">
            {data.provider.provider_config.sendRate == null
              ? "—"
              : `${number.format(data.provider.provider_config.sendRate)}/s`}
          </p>
          <p className="text-xs text-muted-foreground">send rate</p>
        </div>
        <div className="p-4">
          <p className="metric-number text-xl">
            {data.campaigns.find((campaign) => campaign.status === "scheduled")
              ? relative(
                  data.campaigns.find(
                    (campaign) => campaign.status === "scheduled",
                  )?.scheduled_at,
                )
              : "No sends"}
          </p>
          <p className="text-xs text-muted-foreground">next scheduled</p>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0">
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              icon={Send}
              label="Sent this month"
              value={number.format(data.campaignStats.delivered)}
            />
            <Metric
              icon={MailCheck}
              label="Average open rate"
              value={percent(((event.open ?? 0) / delivered) * 100)}
            />
            <Metric
              icon={MousePointerClick}
              label="Average click rate"
              value={percent(((event.click ?? 0) / delivered) * 100)}
            />
            <Metric
              icon={Gauge}
              label="Active subscribers"
              value={number.format(subscribers.active ?? 0)}
            />
          </div>
          <div className="data-grid">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="font-semibold">Recent campaigns</h2>
                <p className="text-xs text-muted-foreground">
                  Delivery status and engagement readiness
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/campaigns")}
              >
                View all <ArrowRight />
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Audience
                  </TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    Sent / scheduled
                  </TableHead>
                  <TableHead className="hidden w-12 sm:table-cell" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.campaigns.map((campaign) => (
                  <TableRow
                    key={campaign.id}
                    className="cursor-pointer"
                    onClick={() =>
                      navigate(
                        campaign.status === "sent"
                          ? `/campaigns/${campaign.id}/report`
                          : `/campaigns/${campaign.id}`,
                      )
                    }
                  >
                    <TableCell>
                      <p className="font-medium">{campaign.subject}</p>
                      <p className="max-w-xs truncate text-xs text-muted-foreground">
                        {campaign.label || "No campaign label"}
                      </p>
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      {campaign.total_recipients
                        ? number.format(campaign.total_recipients)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="min-w-24">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <StatusBadge status={campaign.status} />
                          {campaign.status === "sending" && (
                            <span className="text-xs tabular-nums">
                              {Math.round(
                                (campaign.delivered /
                                  Math.max(1, campaign.total_recipients)) *
                                  100,
                              )}
                              %
                            </span>
                          )}
                        </div>
                        {campaign.status === "sending" && (
                          <Progress
                            value={
                              (campaign.delivered /
                                Math.max(1, campaign.total_recipients)) *
                              100
                            }
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {shortDate(
                        campaign.sent_at ??
                          campaign.scheduled_at ??
                          campaign.created_at,
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
        <aside className="space-y-5">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center justify-between">
                Attention{" "}
                <span className="grid size-6 place-items-center rounded-full bg-red-100 text-xs text-red-700">
                  {data.alerts.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.alerts.map((alert) => (
                <button
                  key={alert.id}
                  onClick={() =>
                    navigate(
                      alert.id.startsWith("paused")
                        ? "/automations"
                        : alert.id === "monthly-allowance"
                          ? "/settings"
                          : "/reports",
                    )
                  }
                  className="flex w-full gap-3 border-b p-4 text-start last:border-b-0 hover:bg-muted/60"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-orange-100 text-orange-700">
                    <AlertTriangle className="size-4" />
                  </span>
                  <span>
                    <strong className="block text-sm">{alert.title}</strong>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {alert.detail}
                    </span>
                  </span>
                </button>
              ))}
              {!data.alerts.length && (
                <p className="p-5 text-sm text-muted-foreground">
                  No active delivery alerts.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-5">
              {data.campaigns.slice(0, 3).map((campaign) => (
                <ActivityItem
                  key={campaign.id}
                  icon={campaign.status === "sent" ? MailCheck : Clock3}
                  text={`${campaign.subject} · ${campaign.status}`}
                  time={relative(
                    campaign.sent_at ??
                      campaign.scheduled_at ??
                      campaign.created_at,
                  )}
                />
              ))}
              {!data.campaigns.length && (
                <p className="text-sm text-muted-foreground">
                  No campaign activity yet.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Send;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="metric-number mt-2 text-2xl">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Current reporting period
          </p>
        </div>
        <Icon className="size-4 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}
function ActivityItem({
  icon: Icon,
  text,
  time,
}: {
  icon: typeof Clock3;
  text: string;
  time: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full border bg-muted">
        <Icon className="size-3.5" />
      </span>
      <div>
        <p className="text-sm leading-snug">{text}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{time}</p>
      </div>
    </div>
  );
}
