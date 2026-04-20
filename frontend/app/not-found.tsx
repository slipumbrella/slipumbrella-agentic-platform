import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
    return (
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md border-border/50 shadow-lg backdrop-blur-sm">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                        <FileQuestion className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <CardTitle className="text-2xl font-bold">Page Not Found</CardTitle>
                    <CardDescription className="text-balance">
                        The page you are looking for doesn&apos;t exist or has been moved.
                    </CardDescription>
                </CardHeader>
                <CardContent className="text-center text-sm text-muted-foreground">
                    Error 404
                </CardContent>
                <CardFooter className="flex justify-center">
                    <Button asChild variant="default" className="w-full sm:w-auto">
                        <Link href="/">
                            Return Home
                        </Link>
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
