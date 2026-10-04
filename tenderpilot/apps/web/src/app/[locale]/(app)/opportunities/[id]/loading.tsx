import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";

export default function OpportunityLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardContent className="flex items-center gap-5 p-5">
              <Skeleton className="size-32 rounded-full" />
              <Skeleton className="h-6 w-32" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-5 p-5">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-2 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
