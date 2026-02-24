const sb = window.supabase.createClient(
    'https://bbqrusqxoynmvmphbnqa.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJicXJ1c3F4b3lubXZtcGhibnFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4OTMzNDYsImV4cCI6MjA4NzQ2OTM0Nn0.mg_M0yaIsP5ICCrQKteFatbIDcZ4oR-N-DsD1qqX60k'
);

let user = null, myData = null, contact = null, channel = null;
let mediaRecorder = null, audioChunks = [], audioStream = null;
let isRecording = false;

// Pedir permissão para notificações
async function requestNotificationPermission() {
    if ('Notification' in window && 'serviceWorker' in navigator) {
        // Registrar service worker
        try {
            await navigator.serviceWorker.register('/sw.js');
        } catch (err) {
            console.log('Service worker não registrado:', err);
        }
        
        // Pedir permissão
        if (Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                new Notification('Toca Cell', {
                    body: 'Notificações ativadas! 🚀',
                    icon: '💬'
                });
            }
        }
    }
}

// Mostrar notificação
function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '💬', badge: '💬' });
    }
}

window.onload = async () => {
    await requestNotificationPermission();
    
    const { data } = await sb.auth.getSession();
    if (data.session) {
        user = data.session.user;
        myData = { id: user.id, phone: 'Carregando...', name: 'Usuário' };
        await sb.from('users').update({ is_online: true }).eq('id', user.id);
        
        const { data: userData } = await sb.from('users').select('*').eq('id', user.id).maybeSingle();
        if (userData) myData = userData;
        
        show('homeScreen');
        loadContacts();
    } else {
        show('setupScreen');
    }
};

document.getElementById('btnRegister').onclick = async () => {
    const name = document.getElementById('nameInput').value.trim();
    const phone = document.getElementById('phoneInput').value.trim();
    if (!name || !phone) return alert('Preencha todos os campos');

    const { data, error } = await sb.auth.signInAnonymously();
    if (error) return alert('Erro: ' + error.message);

    await sb.from('users').insert({ id: data.user.id, phone, name, is_online: true });
    user = data.user;
    myData = { id: user.id, phone, name };
    show('homeScreen');
    loadContacts();
};

async function loadContacts() {
    const { data: myContacts } = await sb.from('contacts').select('contact_phone').eq('user_id', user.id);
    const { data: receivedMessages } = await sb.from('messages').select('sender_id').eq('receiver_id', user.id);
    const senderIds = [...new Set(receivedMessages?.map(m => m.sender_id) || [])];
    
    const allPhones = myContacts?.map(c => c.contact_phone) || [];
    const { data: contactUsers } = await sb.from('users').select().in('phone', allPhones);
    const { data: senderUsers } = await sb.from('users').select().in('id', senderIds);
    
    const allUsers = [...(contactUsers || []), ...(senderUsers || [])];
    const uniqueUsers = Array.from(new Map(allUsers.map(u => [u.id, u])).values());

    const list = document.getElementById('usersList');
    
    if (uniqueUsers.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">👥</div>
                <div class="empty-title">Nenhum contato ainda</div>
                <div class="empty-text">Clique no botão + para adicionar!</div>
            </div>
        `;
        return;
    }

    list.innerHTML = '';
    uniqueUsers.forEach(u => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.onclick = () => openChat(u);
        
        const avatarHtml = u.avatar_url 
            ? `<img src="${u.avatar_url}" class="avatar" alt="${u.name}">` 
            : `<div class="avatar">${u.name[0].toUpperCase()}</div>`;
        
        div.innerHTML = `
            ${avatarHtml}
            <div class="user-info">
                <div class="user-name">${u.name}</div>
                <div class="user-phone">${u.phone}</div>
            </div>
            ${u.is_online ? '<div class="online-dot"></div>' : ''}
        `;
        list.appendChild(div);
    });
}

document.getElementById('btnAddContact').onclick = () => {
    document.getElementById('addContactModal').classList.remove('hidden');
    document.getElementById('addContactInput').value = '';
};

document.getElementById('btnConfirmAdd').onclick = async () => {
    const phone = document.getElementById('addContactInput').value.trim();
    if (!phone) return alert('Digite um número');

    const { data: userExists } = await sb.from('users').select().eq('phone', phone).single();
    if (!userExists) return alert('Usuário não encontrado');

    await sb.from('contacts').insert({ user_id: user.id, contact_phone: phone, contact_user_id: userExists.id });
    document.getElementById('addContactModal').classList.add('hidden');
    loadContacts();
};

document.getElementById('btnCancelAdd').onclick = () => {
    document.getElementById('addContactModal').classList.add('hidden');
};

// Upload de avatar
document.getElementById('avatarInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
        const base64 = event.target.result;
        document.getElementById('avatarPreview').src = base64;
        
        await sb.from('users').update({ avatar_url: base64 }).eq('id', user.id);
        myData.avatar_url = base64;
    };
    reader.readAsDataURL(file);
};

document.getElementById('btnSettings').onclick = () => {
    if (myData && myData.phone) {
        document.getElementById('myNumber').textContent = myData.phone;
        if (myData.avatar_url) {
            document.getElementById('avatarPreview').src = myData.avatar_url;
        }
        document.getElementById('settingsModal').classList.remove('hidden');
    }
};

document.getElementById('btnCloseSettings').onclick = () => {
    document.getElementById('settingsModal').classList.add('hidden');
};

async function openChat(c) {
    contact = c;
    document.getElementById('contactName').textContent = c.name;
    document.getElementById('contactStatus').textContent = c.is_online ? '🟢 Online' : '⚫ Offline';
    show('chatScreen');
    
    const { data } = await sb.from('messages').select()
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${c.id}),and(sender_id.eq.${c.id},receiver_id.eq.${user.id})`)
        .order('created_at');
    
    const list = document.getElementById('messagesList');
    list.innerHTML = '';
    data.forEach(m => addMsg(m));
    list.scrollTop = list.scrollHeight;

    if (channel) sb.removeChannel(channel);
    channel = sb.channel('msgs').on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (p) => {
            const m = p.new;
            if ((m.sender_id === c.id && m.receiver_id === user.id) ||
                (m.sender_id === user.id && m.receiver_id === c.id)) {
                addMsg(m);
                if (m.sender_id === c.id) {
                    showNotification(`${c.name}`, m.message_type === 'audio' ? '🎤 Áudio' : m.content);
                }
            }
        }
    ).subscribe();
}

function addMsg(m) {
    const list = document.getElementById('messagesList');
    const div = document.createElement('div');
    div.className = `message ${m.sender_id === user.id ? 'sent' : 'received'}`;
    const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    let content = '';
    if (m.message_type === 'audio') {
        content = `<div class="audio-message"><audio controls src="${m.media_url}"></audio></div>`;
    } else {
        content = m.content;
    }
    
    div.innerHTML = `${content}<div class="message-time">${time}</div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
}

document.getElementById('btnSend').onclick = async () => {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();
    if (!content) return;
    
    const newMessage = {
        sender_id: user.id, 
        receiver_id: contact.id, 
        content,
        message_type: 'text',
        created_at: new Date().toISOString()
    };
    
    // Mostrar imediatamente
    addMsg(newMessage);
    
    // Enviar pro banco
    await sb.from('messages').insert(newMessage);
    
    input.value = '';
};

document.getElementById('messageInput').onkeypress = (e) => {
    if (e.key === 'Enter') document.getElementById('btnSend').click();
};

// Gravar áudio
document.getElementById('btnAudio').onclick = async () => {
    const btn = document.getElementById('btnAudio');
    
    if (!isRecording) {
        // Começar gravação
        try {
            if (!audioStream) {
                audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
            
            mediaRecorder = new MediaRecorder(audioStream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunks.push(e.data);
                }
            };
            
            mediaRecorder.onstop = async () => {
                if (audioChunks.length === 0) return;
                
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                
                reader.onloadend = async () => {
                    try {
                        await sb.from('messages').insert({ 
                            sender_id: user.id, 
                            receiver_id: contact.id, 
                            content: '🎤 Áudio',
                            message_type: 'audio',
                            media_url: reader.result
                        });
                    } catch (err) {
                        console.error('Erro ao enviar áudio:', err);
                        alert('Erro ao enviar áudio');
                    }
                };
                
                reader.readAsDataURL(audioBlob);
            };
            
            mediaRecorder.start();
            btn.classList.add('recording');
            btn.textContent = '⏹️';
            btn.title = 'Parar e enviar';
            isRecording = true;
            
        } catch (err) {
            alert('Erro ao acessar microfone. Permita o acesso e tente novamente.');
            console.error(err);
        }
    } else {
        // Parar e enviar
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        btn.classList.remove('recording');
        btn.textContent = '🎤';
        btn.title = 'Gravar áudio';
        isRecording = false;
    }
};

document.getElementById('btnBlock').onclick = async () => {
    if (confirm(`Bloquear ${contact.name}?`)) {
        await sb.from('blocked').insert({ user_id: user.id, blocked_user_id: contact.id });
        await sb.from('contacts').delete().eq('user_id', user.id).eq('contact_phone', contact.phone);
        document.getElementById('btnBack').click();
    }
};

document.getElementById('btnBack').onclick = () => {
    if (channel) sb.removeChannel(channel);
    show('homeScreen');
    loadContacts();
};

document.getElementById('btnLogout').onclick = async () => {
    await sb.from('users').update({ is_online: false }).eq('id', user.id);
    await sb.auth.signOut();
    user = null;
    document.getElementById('settingsModal').classList.add('hidden');
    show('setupScreen');
};

function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}
