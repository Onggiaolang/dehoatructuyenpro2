import React, { useState, useEffect } from 'react';
import { User, Role, Room, StudentInfo } from '../types';
import {
  auth,
  signInStudentWithGoogle,
  signOutUser,
  getRoomByCode,
  getStudentSubmission,
  getCurrentUser,
  getClass,
  ensureSignedIn, // ✅ THÊM: để thi tự do vẫn có auth (anonymous)
} from '../services/firebaseService';

interface StudentPortalProps {
  onJoinRoom: (room: Room, student: StudentInfo, submissionId?: string) => void;
}

type LoginMode = 'select' | 'google' | 'anonymous';

const StudentPortal: React.FC<StudentPortalProps> = ({ onJoinRoom }) => {
  const [loginMode, setLoginMode] = useState<LoginMode>('select');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Room join data
  const [roomCode, setRoomCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  // Anonymous mode data
  const [studentName, setStudentName] = useState('');
  const [className, setClassName] = useState('');

  // ✅ THÊM: State để lưu tên lớp thực tế
  const [userClassNames, setUserClassNames] = useState<string[]>([]);

  // Check auth state
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const user = await getCurrentUser();
          setCurrentUser(user);

          // ✅ THÊM: Lấy tên lớp thực tế
          if (user && user.classIds && user.classIds.length > 0) {
            const classNames: string[] = [];
            for (const classId of user.classIds) {
              const classData = await getClass(classId);
              if (classData) classNames.push(classData.name);
            }
            setUserClassNames(classNames);
          }

          if (user && user.role === Role.STUDENT) {
            setLoginMode('google');
          }
        } catch (err) {
          console.error('Get user error:', err);
        }
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleBackToSelect = () => {
    setLoginMode('select');
    setRoomCode('');
    setStudentName('');
    setClassName('');
  };

  const handleGoogleLogin = async () => {
    try {
      const user = await signInStudentWithGoogle();
      if (user) {
        setCurrentUser(user);

        // ✅ THÊM: Lấy tên lớp sau khi đăng nhập
        if (user.classIds && user.classIds.length > 0) {
          const classNames: string[] = [];
          for (const classId of user.classIds) {
            const classData = await getClass(classId);
            if (classData) classNames.push(classData.name);
          }
          setUserClassNames(classNames);
        }

        setLoginMode('google');
      }
    } catch (err) {
      console.error('Login error:', err);
      alert('Đăng nhập thất bại. Vui lòng thử lại.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOutUser();
      setCurrentUser(null);
      setUserClassNames([]);
      setLoginMode('select');
      setRoomCode('');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleJoinRoomGoogle = async () => {
    if (!roomCode.trim()) {
      alert('⚠️ Vui lòng nhập mã phòng!');
      return;
    }

    if (!currentUser) {
      alert('⚠️ Vui lòng đăng nhập trước!');
      return;
    }

    if (currentUser.role !== Role.STUDENT) {
      alert('⚠️ Tài khoản này không phải HỌC SINH.\n\nVui lòng đăng xuất và đăng nhập ở Cổng Giáo viên.');
      return;
    }

    if (!currentUser.isApproved) {
      alert('⚠️ Tài khoản của bạn chưa được Admin duyệt!\n\nVui lòng chờ Admin duyệt tài khoản.');
      return;
    }

    if (!currentUser.classIds || currentUser.classIds.length === 0) {
      alert('⚠️ Bạn chưa được thêm vào lớp nào!\n\nVui lòng liên hệ giáo viên để được thêm vào lớp.');
      return;
    }

    setIsJoining(true);

    try {
      const room = await getRoomByCode(roomCode.trim().toUpperCase());

      if (!room) {
        alert('❌ Không tìm thấy phòng thi với mã này!');
        return;
      }

      if (room.status === 'closed') {
        alert('❌ Phòng thi đã đóng!');
        return;
      }

      if (room.status === 'waiting' && !room.allowLateJoin) {
        alert('❌ Phòng thi chưa bắt đầu!');
        return;
      }

      if (room.classId) {
        if (!currentUser.classIds?.includes(room.classId)) {
          alert(`❌ Bạn không thuộc lớp "${room.className || 'này'}"!\n\nPhòng thi này chỉ dành cho học sinh trong lớp.`);
          return;
        }
      }

      // ✅ SỬA: Lấy tên lớp thực tế thay vì classId
      let studentClassName = userClassNames[0] || undefined;
      if (room.classId && currentUser.classIds) {
        const classIndex = currentUser.classIds.indexOf(room.classId);
        if (classIndex >= 0 && classIndex < userClassNames.length) {
          studentClassName = userClassNames[classIndex];
        }
      }

      const studentInfo: StudentInfo = {
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        avatar: currentUser.avatar,
        className: studentClassName,
      };

      const existingSubmission = await getStudentSubmission(room.id, currentUser.id);

      if (existingSubmission) {
        if (existingSubmission.status === 'submitted') {
          alert('✅ Bạn đã nộp bài rồi!\n\nKhông thể làm lại.');
          return;
        }
        onJoinRoom(room, studentInfo, existingSubmission.id);
      } else {
        onJoinRoom(room, studentInfo);
      }
    } catch (err) {
      console.error('Join room error:', err);
      alert('❌ Có lỗi xảy ra. Vui lòng thử lại!');
    } finally {
      setIsJoining(false);
    }
  };

  // ✅✅✅ THI TỰ DO: dùng Anonymous Auth ẨN + student.id = auth.uid
  const handleJoinRoomAnonymous = async () => {
    if (!roomCode.trim()) {
      alert('⚠️ Vui lòng nhập mã phòng!');
      return;
    }

    if (!studentName.trim()) {
      alert('⚠️ Vui lòng nhập họ tên!');
      return;
    }

    setIsJoining(true);

    try {
      // ✅ 1) Bảo đảm có auth (anonymous) trước khi đọc room / tạo submission
      await ensureSignedIn();
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('Anonymous auth failed');

      // ✅ 2) Giờ đọc room sẽ không còn bị rules chặn (request.auth != null)
      const room = await getRoomByCode(roomCode.trim().toUpperCase());

      if (!room) {
        alert('❌ Không tìm thấy phòng thi với mã này!');
        return;
      }

      if (!room.allowAnonymous) {
        alert('⚠️ Phòng này yêu cầu đăng nhập Google!\n\nVui lòng quay lại và chọn "Đăng nhập Google".');
        return;
      }

      if (room.status === 'closed') {
        alert('❌ Phòng thi đã đóng!');
        return;
      }

      if (room.status === 'waiting' && !room.allowLateJoin) {
        alert('❌ Phòng thi chưa bắt đầu!');
        return;
      }

      // ✅ 3) IMPORTANT: student.id phải = auth.uid để phù hợp rules update
      const anonymousStudent: StudentInfo = {
        id: uid,
        name: studentName.trim(),
        className: className.trim() || undefined,
      };

      onJoinRoom(room, anonymousStudent);
    } catch (err) {
      console.error('Join room error:', err);
      alert('❌ Có lỗi xảy ra. Vui lòng thử lại!\n\n' + (err as Error)?.message);
    } finally {
      setIsJoining(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-teal-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-teal-500 border-t-transparent mx-auto mb-4"></div>
          <p className="text-teal-700">Đang kiểm tra...</p>
        </div>
      </div>
    );
  }

  if (loginMode === 'select' && !currentUser) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 50%, #99f6e4 100%)' }}
      >
        <div className="max-w-lg w-full">
          <div className="text-center mb-10">
            <div className="text-8xl mb-4">🎓</div>
            <h1 className="text-4xl font-bold text-teal-900 mb-2">Cổng Học Sinh</h1>
            <p className="text-teal-600 text-lg">Chọn cách vào phòng thi</p>
          </div>

          <div className="space-y-4">
            <button
              onClick={() => setLoginMode('google')}
              className="w-full bg-white rounded-2xl p-6 shadow-xl hover:shadow-2xl transition transform hover:scale-105 text-left flex items-center gap-5"
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: 'linear-gradient(135deg, #4285F4 0%, #34A853 50%, #FBBC05 75%, #EA4335 100%)' }}
              >
                🔐
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-gray-900">Đăng nhập Google</h2>
                <p className="text-gray-500">Dùng tài khoản Google để thi</p>
              </div>
              <div className="text-teal-500 text-2xl">→</div>
            </button>

            <button
              onClick={() => setLoginMode('anonymous')}
              className="w-full bg-white rounded-2xl p-6 shadow-xl hover:shadow-2xl transition transform hover:scale-105 text-left flex items-center gap-5"
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)' }}
              >
                ✍️
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-gray-900">Thi tự do</h2>
                <p className="text-gray-500">Chỉ cần nhập tên, không cần đăng nhập</p>
              </div>
              <div className="text-orange-500 text-2xl">→</div>
            </button>
          </div>

          <p className="text-center text-teal-600 mt-8 text-sm">
            💡 Chế độ "Thi tự do" chỉ khả dụng nếu giáo viên cho phép
          </p>
        </div>
      </div>
    );
  }

  if (loginMode === 'anonymous') {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 50%, #99f6e4 100%)' }}
      >
        <div className="max-w-md w-full">
          <div className="bg-white rounded-3xl shadow-2xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">✍️</div>
              <h1 className="text-2xl font-bold text-gray-900">Thi tự do</h1>
              <p className="text-gray-500 mt-1">Nhập thông tin để vào thi</p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Mã phòng thi <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="Nhập mã phòng (VD: ABC123)"
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none font-mono text-lg"
                maxLength={6}
                disabled={isJoining}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Họ và tên <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Nhập họ tên của bạn"
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
                disabled={isJoining}
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Lớp (không bắt buộc)
              </label>
              <input
                type="text"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="VD: 10A1, 11B2..."
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
                disabled={isJoining}
              />
            </div>

            <div className="space-y-3">
              <button
                onClick={handleJoinRoomAnonymous}
                disabled={isJoining || !roomCode.trim() || !studentName.trim()}
                className="w-full py-3 rounded-xl font-bold text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: isJoining || !roomCode.trim() || !studentName.trim()
                    ? '#94a3b8'
                    : 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)'
                }}
              >
                {isJoining ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Đang xử lý...
                  </span>
                ) : (
                  '🚀 Vào thi'
                )}
              </button>

              <button
                onClick={handleBackToSelect}
                disabled={isJoining}
                className="w-full py-3 rounded-xl font-semibold border-2 border-gray-300 hover:bg-gray-50 transition disabled:opacity-50"
              >
                ← Quay lại
              </button>
            </div>

            <div className="mt-6 p-3 bg-yellow-50 border-l-4 border-yellow-500 rounded text-sm text-yellow-800">
              <strong>Lưu ý:</strong> Chế độ thi tự do không lưu tài khoản Google. Kết quả sẽ gắn với phiên thi ẩn (anonymous).
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loginMode === 'google' && !currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-teal-50 to-green-50 p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="text-7xl mb-4">🎓</div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Cổng Học Sinh</h1>
            <p className="text-gray-600">Đăng nhập để vào phòng thi</p>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4">📝 Yêu cầu đăng nhập</h2>

            <div className="space-y-4 mb-6">
              <div className="flex items-start gap-3 text-sm text-gray-600">
                <span className="text-teal-500">✓</span>
                <p>Đăng nhập bằng tài khoản Google</p>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-600">
                <span className="text-teal-500">✓</span>
                <p>Chờ Admin duyệt tài khoản</p>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-600">
                <span className="text-teal-500">✓</span>
                <p>Giáo viên thêm bạn vào lớp</p>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-600">
                <span className="text-teal-500">✓</span>
                <p>Nhập mã phòng để vào thi</p>
              </div>
            </div>

            <button
              onClick={handleGoogleLogin}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition transform hover:scale-105 flex items-center justify-center gap-3 mb-4"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Đăng nhập với Google
            </button>

            <button
              onClick={handleBackToSelect}
              className="w-full py-3 rounded-xl font-semibold border-2 border-gray-300 hover:bg-gray-50 transition"
            >
              ← Quay lại
            </button>

            <p className="text-center text-sm text-gray-500 mt-4">
              Lần đầu đăng nhập? Tài khoản sẽ được tạo tự động
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Các nhánh UI khác bạn giữ nguyên như file gốc (approved/unapproved)...
  // Mình giữ nguyên logic, không sửa phần UI phía dưới vì không liên quan rules.

  if (currentUser && !currentUser.isApproved) {
    // ... giữ nguyên như bạn đã có
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-orange-50 p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">⏳</div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Chờ duyệt tài khoản</h2>
            </div>

            <button
              onClick={handleLogout}
              className="w-full py-3 border-2 border-gray-300 rounded-xl font-semibold text-gray-700 hover:bg-gray-50 transition"
            >
              Đăng xuất
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (currentUser && currentUser.isApproved) {
    // ... giữ nguyên như bạn đã có
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-blue-50 to-purple-50 p-4">
        <div className="max-w-2xl mx-auto pt-12">
          <div className="bg-white rounded-2xl shadow-2xl p-6 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {currentUser.avatar ? (
                  <img src={currentUser.avatar} alt="" className="w-16 h-16 rounded-full" />
                ) : (
                  <div className="w-16 h-16 bg-teal-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                    {currentUser.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <h2 className="text-xl font-bold text-gray-800">{currentUser.name}</h2>
                  {userClassNames.length > 0 ? (
                    <p className="text-sm text-teal-600 mt-1">📚 Lớp: {userClassNames.join(', ')}</p>
                  ) : (
                    <p className="text-sm text-gray-500">{currentUser.email}</p>
                  )}
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition text-sm"
              >
                Đăng xuất
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                ✓ Đã duyệt
              </span>
              {userClassNames.length > 0 && (
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                  ✓ Có lớp học
                </span>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <div className="text-center mb-8">
              <div className="text-6xl mb-4">🏠</div>
              <h1 className="text-3xl font-bold text-gray-800 mb-2">Vào Phòng Thi</h1>
              <p className="text-gray-600">Nhập mã phòng để bắt đầu làm bài</p>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                🔑 Mã phòng (6 ký tự)
              </label>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                onKeyPress={(e) => e.key === 'Enter' && handleJoinRoomGoogle()}
                placeholder="VD: ABC123"
                maxLength={6}
                className="w-full px-4 py-4 text-2xl text-center font-mono font-bold border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:ring-4 focus:ring-teal-200 focus:outline-none uppercase tracking-widest"
                disabled={isJoining}
              />
            </div>

            <button
              onClick={handleJoinRoomGoogle}
              disabled={isJoining || !roomCode.trim()}
              className="w-full bg-gradient-to-r from-teal-500 to-teal-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {isJoining ? '⏳ Đang kiểm tra...' : '🚀 Vào Phòng Thi'}
            </button>

            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm text-blue-800">
                💡 <strong>Lưu ý:</strong> Chỉ vào được phòng thi của lớp bạn đang học.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default StudentPortal;
