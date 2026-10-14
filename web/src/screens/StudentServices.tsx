import type { StudentServices } from '../../../shared/student-services'
import { StateBanner } from '../components/StateBanner'
import { ScreenSkeleton } from '../components/Skeleton'
import { useEndpoint } from '../lib/api'
import { WorkflowLink } from '../lib/workflows'

export function StudentServicesScreen() {
  const { data, meta, error, loading, reload } = useEndpoint<StudentServices>('/api/student-services')
  return <section className="screen services-screen">
    <header className="page-header"><div><h1>Sprawy uczelniane</h1><p className="page-description">Podpięcia, ankiety, egzaminy i pozostałe sprawy w jednym miejscu.</p></div>
      <button className="button button-secondary" onClick={reload} disabled={loading}>Sprawdź moduły konta</button></header>
    <StateBanner meta={meta} error={error} onReload={reload} />
    {loading && !data && <ScreenSkeleton />}
    {data && <><p className="section-note">Lista pochodzi z odnośników udostępnionych w bieżącej sesji USOS. Brak odnośnika oznacza „nie wykryto”, a nie brak uprawnień ani brak spraw. Szczegóły i obsługiwane formularze otwieramy tutaj.</p>
      <ul className="service-list">{data.services.map(service => <li key={service.id}><div><h2>{service.title}</h2><p>{service.description}</p></div>
        {service.link ? <WorkflowLink link={service.link} className="button button-secondary">Otwórz {service.title}</WorkflowLink>
          : <span className="service-status">Nie wykryto w menu konta</span>}</li>)}</ul>
    </>}
  </section>
}
