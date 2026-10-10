import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";

export default function ProfileLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <Card key={i}>
          <CardContent className="flex flex-col gap-4 p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
