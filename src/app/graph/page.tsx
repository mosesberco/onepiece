import { fetchGraph } from '@/app/actions/graph';
import GraphView from '@/app/components/GraphView';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const data = await fetchGraph();
  return <GraphView data={data} />;
}
