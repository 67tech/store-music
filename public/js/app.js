document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // Navigation
  const tabs = document.querySelectorAll('.sm-nav-tab');
  const sections = document.querySelectorAll('.sm-section');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('sm-nav-tab--active'));
      sections.forEach(s => s.classList.remove('sm-section--active'));
      tab.classList.add('sm-nav-tab--active');
      document.getElementById(`section-${target}`).classList.add('sm-section--active');
    });
  });

  // Close modal
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal').classList.remove('sm-modal--open');
  });
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') {
      document.getElementById('modal').classList.remove('sm-modal--open');
    }
  });

  // Init modules
  initPlayer(socket);
  initPlaylists();
  initSchedule();
  initAnnouncements();
});
